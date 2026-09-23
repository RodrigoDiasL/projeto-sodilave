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
