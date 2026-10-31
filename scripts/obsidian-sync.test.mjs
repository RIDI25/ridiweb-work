import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanVault } from './obsidian-sync.mjs';
test('only visible Markdown is indexed, hidden files and outside symlinks stay out', async () => {
  const root = await mkdtemp(join(tmpdir(),'optify-vault-test-'));
  try {
    const vault = join(root,'vault'); await mkdir(join(vault,'.obsidian'),{recursive:true}); await mkdir(join(vault,'기획'));
    await writeFile(join(vault,'기획','비서.md'),'# 기획\n결정 사항');
    await writeFile(join(vault,'.hidden.md'),'secret'); await writeFile(join(vault,'.obsidian','config.md'),'secret');
    await writeFile(join(root,'outside.md'),'outside'); await symlink(join(root,'outside.md'),join(vault,'linked.md'));
    await writeFile(join(vault,'big.md'),'a'.repeat(1000001)); await writeFile(join(vault,'photo.png'),'image');
    const result = await scanVault(vault); assert.equal(result.notes.length,1); assert.equal(result.notes[0].path,'기획/비서.md'); assert.equal(result.skipped,2);
    await rm(join(vault,'기획','비서.md')); assert.equal((await scanVault(vault)).notes.length,0);
    await assert.rejects(()=>scanVault(join(root,'missing'))); await rm(join(vault,'.obsidian'),{recursive:true}); await assert.rejects(()=>scanVault(vault));
  } finally { await rm(root,{recursive:true,force:true}); }
});
