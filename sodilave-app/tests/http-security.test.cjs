/* Smoke tests against the built production server; no live deployment involved. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
let server,base,output='';
before(async()=>{
  const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['server.cjs'],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw new Error('Production server exited: '+output);
    try{const r=await fetch(base+'/api/health');if(r.status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Production server failed to start: '+output);
});
after(async()=>{if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}});
test('production CSP has a fresh nonce matching every script, security headers and no shared cache',async()=>{
  const first=await fetch(base+'/login');assert.equal(first.status,200);
  const policy=first.headers.get('content-security-policy');
  const nonce=policy.match(/'nonce-([^']+)'/)[1];
  assert.match(policy,/strict-dynamic/);
  assert.doesNotMatch(policy.split(';').find(d=>d.trim().startsWith('script-src')),/unsafe-inline|unsafe-eval/);
  assert.equal(first.headers.get('x-frame-options'),'DENY');
  assert.equal(first.headers.get('x-content-type-options'),'nosniff');
  assert.match(first.headers.get('cache-control'),/no-store/);
  const html=await first.text();
  const scripts=[...html.matchAll(/<script\b([^>]*)>/g)];assert.ok(scripts.length>0);
  assert.ok(scripts.every(s=>s[1].includes(`nonce="${nonce}"`)),'all framework and inline scripts must match the response nonce');
  const second=await fetch(base+'/login');assert.notEqual(second.headers.get('content-security-policy'),policy);
});
test('mutations reject missing/foreign origins and anonymous pages redirect to login',async()=>{
  for(const headers of [{},{origin:'https://attacker.invalid'},{origin:process.env.APP_URL,'sec-fetch-site':'cross-site'}]) {
    const response=await fetch(base+'/login',{method:'POST',headers,body:'pin=00000000'});
    assert.equal(response.status,403);
  }
  const response=await fetch(base+'/dashboard',{redirect:'manual'});
  assert.ok([303,307].includes(response.status));assert.equal(response.headers.get('location'),'/login');
});
test('patched image dependency still optimizes the machine icon',async()=>{
  const response=await fetch(base+'/_next/image?url=%2Fmachine-jerrycan.png&w=128&q=75');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\//);
});
test('TV landing exposes no production data, API requires its own device token and pairing rejects cross-site/large bodies',async()=>{
  const page=await fetch(base+'/display');assert.equal(page.status,200);
  assert.doesNotMatch(await page.text(),/DISPLAY-ACTUAL|TEST-COMMERCIAL/);
  const api=await fetch(base+'/api/production-display');assert.equal(api.status,401);assert.match(api.headers.get('cache-control'),/no-store/);
  const forged=await fetch(base+'/api/production-display',{headers:{cookie:'__Host-sodilave_display='+'a'.repeat(64)}});assert.equal(forged.status,401);
  const rejected=await fetch(base+'/api/production-display/pair',{method:'POST',headers:{origin:'https://attacker.invalid'},body:'{"code":"00000000"}'});assert.equal(rejected.status,403);
  const large=await fetch(base+'/api/production-display/pair',{method:'POST',headers:{origin:process.env.APP_URL,'content-type':'application/json'},body:'x'.repeat(300)});assert.equal(large.status,413);
});
test('real pairing issues a secure read-only cookie and revocation blocks the next refresh',async()=>{
  const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
  assert.ok(database&&['sodilave_test','typecheck'].includes(new URL(database).pathname.slice(1)),'Only a disposable integration database is allowed');
  const connection=await require('mysql2/promise').createConnection(database);
  await connection.query("SET SESSION time_zone = '+00:00'");
  const {randomUUID,createHash}=require('node:crypto');const id=randomUUID(),code='90807060';
  try {
    const [[admin]]=await connection.execute("SELECT id FROM User WHERE role='ADMIN' AND active=1 LIMIT 1");
    await connection.execute("DELETE FROM AuthRateLimit WHERE bucket='display:pair'");
    await connection.execute('INSERT INTO ProductionDisplayDevice (id,name,pairingHash,pairingExpiresAt,createdById) VALUES (?,?,?,DATE_ADD(NOW(3),INTERVAL 10 MINUTE),?)',[id,'HTTP TV',createHash('sha256').update(code).digest('hex'),admin.id]);
    const response=await fetch(base+'/api/production-display/pair',{method:'POST',headers:{origin:process.env.APP_URL,'content-type':'application/json'},body:JSON.stringify({code})});
    assert.equal(response.status,200,await response.text());const cookie=response.headers.get('set-cookie');
    assert.match(cookie,/__Host-sodilave_display=/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=strict/i);
    const headers={cookie:cookie.split(';')[0]};
    const data=await fetch(base+'/api/production-display',{headers});assert.equal(data.status,200);
    const body=await data.json();assert.ok(Array.isArray(body.machines));assert.deepEqual(Object.keys(body).sort(),['cycleActive','generatedAt','machines','shift','validUntil']);
    assert.doesNotMatch(JSON.stringify(body),/pinHash|customerName|sessionVersion|tokenHash|quantityAvailable/);
    const dashboard=await fetch(base+'/dashboard',{headers,redirect:'manual'});assert.equal(dashboard.headers.get('location'),'/login');
    const replay=await fetch(base+'/api/production-display/pair',{method:'POST',headers:{origin:process.env.APP_URL,'content-type':'application/json'},body:JSON.stringify({code})});assert.equal(replay.status,400);
    await connection.execute('UPDATE ProductionDisplayDevice SET revokedAt=NOW(3) WHERE id=?',[id]);
    assert.equal((await fetch(base+'/api/production-display',{headers})).status,401);
  } finally {await connection.execute('DELETE FROM ProductionDisplayDevice WHERE id=?',[id]);await connection.end();}
});
