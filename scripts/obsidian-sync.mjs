// Local-only bridge. No HTTP listener; never writes to the Obsidian vault.
import { readFile, readdir, lstat, realpath, open, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, join, basename, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export const hash = text => createHash('sha256').update(text).digest('hex');
export async function scanVault(vaultPath) {
  const root = await realpath(vaultPath);
  if (!(await lstat(join(root, '.obsidian'))).isDirectory()) throw new Error('볼트 설정 폴더를 확인할 수 없어요.');
  const notes = []; let skipped = 0, total = 0;
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) { skipped++; continue; }
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const canonical = await realpath(path);
      const rel = relative(root, canonical);
      if (rel.startsWith('..' + '/') || isAbsolute(rel)) throw new Error('볼트 밖 파일은 연결하지 않습니다.');
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await file.stat();
        if (before.size > 1000000) { skipped++; continue; }
        const body = (await file.readFile()).toString('utf8');
        const after = await file.stat();
        if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('노트가 수정 중이에요. 다음 실행에서 다시 확인합니다.');
        if (body.includes('\u0000') || body.length > 1000000) { skipped++; continue; }
        total += Buffer.byteLength(body);
        if (total > 20000000 || notes.length >= 5000) throw new Error('볼트 연결 용량을 확인해 주세요.');
        notes.push({ path: relative(root, path).split('\\').join('/'), title: basename(path).replace(/\.md$/i, ''), body, content_hash: hash(body), source_modified_at: after.mtime.toISOString() });
      } finally { await file.close(); }
    }
  }
  await walk(root);
  notes.sort((a,b) => a.path.localeCompare(b.path));
  return { notes, skipped };
}

async function main(configPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!config.ownerId || !config.vaultPath || !config.envFile) throw new Error('연결 설정을 확인해 주세요.');
  const env = parseEnv(await readFile(config.envFile, 'utf8'));
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base?.startsWith('https://') || !key) throw new Error('워크스페이스 연결 정보를 확인해 주세요.');
  const stateDir = dirname(configPath);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const lockPath = join(stateDir, 'sync.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('연결 작업 잠금을 확인해 주세요.');
    try { process.kill(pid, 0); return; } catch (e) { if (e.code !== 'ESRCH') return; }
    await unlink(lockPath); lock = await open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(String(process.pid));
  const vaultName = basename(config.vaultPath);
  async function api(path, method, body, prefer = '') {
    const response = await fetch(`${base}/rest/v1/${path}`, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`워크스페이스 연결 실패 (${response.status}).`);
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  try {
    const profiles = await api(`profiles?id=eq.${encodeURIComponent(config.ownerId)}&select=id`, 'GET');
    if (profiles.length !== 1) throw new Error('연결 계정을 확인해 주세요.');
    const snapshot = await scanVault(config.vaultPath);
    const fingerprint = hash(JSON.stringify({ owner: config.ownerId, vault: config.vaultPath, ...snapshot }));
    const cachePath = join(stateDir, 'last-sync.json');
    let cache; try { cache = JSON.parse(await readFile(cachePath, 'utf8')); } catch { cache = null; }
    if (cache?.fingerprint === fingerprint && Date.now() - cache.time < 3600000) {
      await api('vault_sync_state?on_conflict=owner_id', 'POST', { owner_id: config.ownerId, vault_name: vaultName, note_count: snapshot.notes.length, skipped_count: snapshot.skipped, last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), error: null }, 'resolution=merge-duplicates');
    } else {
      await api('rpc/sync_vault_notes', 'POST', { p_owner: config.ownerId, p_vault: vaultName, p_notes: snapshot.notes, p_skipped: snapshot.skipped });
      await writeFile(cachePath + '.tmp', JSON.stringify({ fingerprint, time: Date.now() }), { mode: 0o600 });
      await rename(cachePath + '.tmp', cachePath);
      console.log(`${new Date().toISOString()} 연결 완료: ${snapshot.notes.length}개, 제외 ${snapshot.skipped}개`);
    }
  } catch (error) {
    // Keep the previous index intact on any scan/network failure. Never log contents or credentials.
    await api(`vault_sync_state?owner_id=eq.${encodeURIComponent(config.ownerId)}`, 'PATCH', { last_attempt_at: new Date().toISOString(), error: '맥의 볼트 연결을 확인해 주세요. 마지막으로 반영된 자료를 표시합니다.' }).catch(() => undefined);
    throw error;
  } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const configPath = process.argv[process.argv.indexOf('--config') + 1];
  if (!process.argv.includes('--config') || !configPath) { console.error('Usage: node scripts/obsidian-sync.mjs --config /absolute/config.json'); process.exitCode = 1; }
  else await main(resolve(configPath)).catch(() => { console.error(`${new Date().toISOString()} 볼트 연결 실패. 맥의 경로·인터넷·계정 설정을 확인해 주세요.`); process.exitCode = 1; });
}
