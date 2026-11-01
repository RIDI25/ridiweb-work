import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001', member = '10000000-0000-4000-8000-000000000002';
const client = '20000000-0000-4000-8000-000000000001', partner = '20000000-0000-4000-8000-000000000002';
const login = async (id) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); };
let passed = 0;
const test = async (name, run) => { await run(); console.log('PASS', name); passed++; };
try {
  await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;
    create table profiles(id uuid primary key,role text); create table clients(id uuid primary key,name text,kind text default 'client'); create table quotes(id uuid primary key);
    create function is_team_member() returns boolean language sql security definer as $$select exists(select 1 from profiles where id=auth.uid())$$;
    create function get_my_role() returns text language sql security definer as $$select role from profiles where id=auth.uid()$$;`);
  await db.query("insert into profiles values($1,'owner'),($2,'member')",[owner,member]);
  await db.query("insert into clients values($1,'고객','client'),($2,'협력사','partner')",[client,partner]);
  await db.exec(await readFile(new URL('../migrations/0019_client_services.sql',import.meta.url),'utf8'));
  await db.exec(`alter table client_services add column monthly_quota int;
    grant all on client_services to authenticated; grant select on clients to authenticated;
    create policy ridiweb_scope on client_services as restrictive for all to authenticated using(auth.uid()='${owner}'::uuid) with check(auth.uid()='${owner}'::uuid);`);
  await db.query("insert into client_services(client_id,service_type) values($1,'legacy')",[client]);
  const migration = await readFile(new URL('../migrations/0039_service_partners.sql',import.meta.url),'utf8');
  await db.exec(migration); await db.exec(migration);
  await login(owner);
  let service;
  await test('legacy remains unclassified, mixed customer contracts stay separate', async () => {
    assert.equal((await db.query("select deal_channel from client_services where service_type='legacy'")).rows[0].deal_channel,null);
    service=(await db.query("insert into client_services(client_id,service_type,billing,deal_channel,partner_id,communication_contact,final_reviewer,settlement_party,monthly_quota) values($1,'site_build','period','partner',$2,'담당','검수','정산',4) returning id",[client,partner])).rows[0].id;
    await db.query("insert into client_services(client_id,service_type,deal_channel) values($1,'seo','direct')",[client]);
    assert.equal((await db.query('select count(*)::int n from client_services where client_id=$1',[client])).rows[0].n,3);
  });
  await test('partner must be linked, cannot be a client, self or an orphaned channel', async () => {
    for(const [channel, partnerId] of [['partner',null],['partner',client],['direct',partner],[null,partner],['referral',null]]) {
      await assert.rejects(() => db.query('update client_services set deal_channel=$2,partner_id=$3 where id=$1',[service,channel,partnerId]));
    }
    await assert.rejects(() => db.query('update client_services set client_id=$2 where id=$1',[service,partner]));
  });
  await test('linked partner cannot be deleted or reclassified', async () => {
    await db.exec('reset role');
    await assert.rejects(() => db.query("update clients set kind='client' where id=$1",[partner]));
    await assert.rejects(() => db.query('delete from clients where id=$1',[partner]));
    await login(owner);
  });
  await test('changing channel clears partner without changing other contracts', async () => {
    await db.query("update client_services set deal_channel='direct',partner_id=null where id=$1",[service]);
    assert.equal((await db.query("select deal_channel from client_services where service_type='seo'")).rows[0].deal_channel,'direct');
    await db.query("update client_services set deal_channel='partner',partner_id=$2 where id=$1",[service,partner]);
  });
  await test('failed renewal preserves original; successful renewal copies roles and route once', async () => {
    await assert.rejects(()=>db.query("select renew_client_service($1,'2026-12-10','2026-12-01')",[service]));
    assert.equal((await db.query('select status from client_services where id=$1',[service])).rows[0].status,'active');
    const newId=(await db.query("select renew_client_service($1,'2026-12-01','2027-05-31') id",[service])).rows[0].id;
    const fresh=(await db.query('select * from client_services where id=$1',[newId])).rows[0];
    assert.equal(fresh.partner_id,partner); assert.equal(fresh.communication_contact,'담당'); assert.equal(fresh.final_reviewer,'검수'); assert.equal(fresh.settlement_party,'정산'); assert.equal(fresh.monthly_quota,4);
    await assert.rejects(()=>db.query("select renew_client_service($1,'2026-12-01','2027-05-31')",[service]));
  });
  await test('MoAI-only member cannot read, alter, add or renew contracts', async () => {
    await login(member); assert.equal((await db.query('select * from client_services')).rows.length,0);
    assert.equal((await db.query("update client_services set settlement_party='forged' returning id")).rows.length,0);
    await assert.rejects(()=>db.query("insert into client_services(client_id,service_type,deal_channel) values($1,'forged','direct')",[client]));
    await assert.rejects(()=>db.query("select renew_client_service($1,'2026-12-01','2027-05-31')",[service]));
  });
  console.log(JSON.stringify({passed,migration:'0039',rerun:true}));
} finally { await db.close(); }
