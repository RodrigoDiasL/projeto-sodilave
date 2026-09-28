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

test('production pages enforce commerce roles and provide auditors read-only catalogue and traceability access',async()=>{
  const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
  assert.ok(database&&['sodilave_test','typecheck'].includes(new URL(database).pathname.slice(1)));
  const connection=await require('mysql2/promise').createConnection(database);
  const {SignJWT}=await import('jose');const {randomUUID}=require('node:crypto');
  await connection.query("SET SESSION time_zone='+00:00'");
  try {
    for(const role of ['OPERATOR','LOGISTICS','AUDITOR','PRODUCTION_MANAGER','ADMIN']) {
      const [insert]=await connection.execute('INSERT INTO User (name,pinHash,role,active) VALUES (?,?,?,1)',['HTTP role '+role,'http-no-real-pin',role]);
      const id=insert.insertId,session=randomUUID();
      await connection.execute('INSERT INTO AuthSession (id,userId,sessionVersion,expiresAt) VALUES (?,?,1,DATE_ADD(NOW(3),INTERVAL 1 HOUR))',[session,id]);
      const token=await new SignJWT({userId:id,sessionVersion:1}).setProtectedHeader({alg:'HS256'}).setJti(session).setIssuer('sodilave').setAudience('sodilave-session').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
      const headers={cookie:'__Host-sodilave_session='+token};
      const get=path=>fetch(base+path,{headers,redirect:'manual'});
      try {
        const orders=await get('/orders');
        if(role==='OPERATOR') {assert.equal(orders.headers.get('location'),'/access-denied');for(const path of ['/orders/new','/lot-dispatch'])assert.equal((await get(path)).headers.get('location'),'/access-denied');}
        else assert.equal(orders.status,200);
        if(role==='LOGISTICS') {assert.equal((await get('/orders/new')).status,200);assert.equal((await get('/checkups')).status,200);assert.equal((await get('/admin/users')).headers.get('location'),'/access-denied');}
        if(role==='AUDITOR') {
          for(const path of ['/admin/queries','/admin/productions','/admin/checkups','/admin/raw-materials','/admin/products','/admin/users','/admin/settings','/admin/production-display','/maintenance','/traceability','/lot-dispatch']) {
            const response=await get(path);assert.equal(response.status,200,path);const html=await response.text();
            assert.doesNotMatch(html,/<input[^>]+type="password"/,path);
            assert.doesNotMatch(html,/>Adicionar produto<|>Guardar alterações<|>Criar utilizador<|>Dar entrada de lote<|>Ativar nova regra<|>Criar manutenção</,path);
          }
          for(const path of ['/orders/new','/startup','/shutdown','/intermediate-startup'])assert.equal((await get(path)).headers.get('location'),'/access-denied',path);
        }
        if(role!=='ADMIN'){for(const path of ['/admin/productions/1/edit','/admin/products/1/variant'])assert.equal((await get(path)).headers.get('location'),'/access-denied');assert.equal((await get('/admin/storage')).headers.get('location'),'/access-denied');assert.equal((await get('/admin/import-history')).headers.get('location'),'/access-denied');}
        if(['ADMIN','PRODUCTION_MANAGER','AUDITOR'].includes(role)){
          const response=await get('/commercial-lots');assert.equal(response.status,200);const html=await response.text();
          assert.equal((await get('/admin/lot-rules')).headers.get('location'),'/commercial-lots');
          assert.doesNotMatch(html,/>Guardar letras para novos registos</,'no product is automatically selected');
          assert.match(html,/<option(?=[^>]*value="")(?=[^>]*selected)[^>]*>Selecione o produto/);
          const [[product]]=await connection.query('SELECT id FROM Product WHERE active=1 ORDER BY id LIMIT 1');
          const selected=await get('/commercial-lots?productId='+product.id);assert.equal(selected.status,200);const selectedHtml=await selected.text();
          if(role==='AUDITOR')assert.doesNotMatch(selectedHtml,/>Guardar letras para novos registos<|>Guardar correção deste lote</);
          else {
            assert.match(selectedHtml,/>Guardar letras para novos registos</);
            for(const label of ['primeira','segunda'])assert.match(selectedHtml,new RegExp('<option(?=[^>]*value="")(?=[^>]*selected)[^>]*>Selecione a '+label+' letra'));
            assert.match(selectedHtml,/<button(?=[^>]*type="submit")(?![^>]*disabled)[^>]*>Guardar letras para novos registos<\/button>/);
          }
        }
        if(role==='ADMIN') {
          const importer=await get('/admin/import-history');assert.equal(importer.status,200);assert.match(await importer.text(),/Descarregar modelo CSV/);
          const storage=await get('/admin/storage');assert.equal(storage.status,200);assert.match(await storage.text(),/Dar entrada de stock inicial/);
          const dashboard=await (await get('/dashboard')).text();assert.doesNotMatch(dashboard,/>Estado das máquinas</);assert.match(dashboard,/Contadores de Produção/);
          const html=await (await get('/admin/users')).text();assert.match(html,/Logística e Expedição/);assert.match(html,/Auditor \(só consulta\)/);
          const products=await (await get('/admin/products')).text();assert.match(products,/value="UNIT"/);assert.match(products,/Criar variante/);
          const stockPage=await get('/stock-map');assert.equal(stockPage.status,200);assert.match(await stockPage.text(),/Stock por artigo/);
        }
      } finally {await connection.execute('DELETE FROM AuthSession WHERE id=?',[session]);await connection.execute('DELETE FROM User WHERE id=?',[id]);}
    }
  } finally {await connection.end();}
});
