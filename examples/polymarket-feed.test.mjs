// Exercises the documented client over real loopback HTTP and WebSocket.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const token = 'x'.repeat(43), key = 'synthetic-public', secret = 'synthetic-secret';
let mode, signed = 0, upgraded = 0;
const server = createServer((req, res) => {
  const timestamp = req.headers['x-bravado-timestamp'];
  const payload = [timestamp, 'GET', req.url, createHash('sha256').update('').digest('hex')].join('\n');
  assert.equal(req.headers['x-bravado-api-key'], key);
  assert.equal(req.headers['x-bravado-signature'], createHmac('sha256', secret).update(payload).digest('hex'));
  assert.equal(req.url, '/mempool/token' + (mode === 'fills' ? '' : '?families=collateral%2Cresolutions%2Cconditions%2Ctoken_registrations'));
  signed++;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({token, expires_at:Math.floor(Date.now()/1000)+300, families:['collateral','resolutions','conditions','token_registrations']}));
});
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  assert.equal(url.pathname, mode === 'fills' ? '/ws/console' : '/ws/onchain');
  assert.equal(url.searchParams.get('token'), token);
  assert.equal(url.searchParams.get('mode'), 'full');
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const frame = Buffer.from(JSON.stringify({type:mode === 'fills' ? 'fill' : 'collateral',synthetic:true}));
  socket.write(Buffer.concat([Buffer.from([0x81,frame.length]),frame]));
  socket.on('data', data => { if ((data[0] & 15) === 8) socket.end(Buffer.from([0x88,2,3,232])); });
  socket.on('error',()=>{});
  upgraded++;
});
server.listen(0,'127.0.0.1');await once(server,'listening');
try {
  for (mode of ['onchain','fills']) {
    const port=server.address().port;
    const child=spawn(process.execPath,['examples/polymarket-feed.mjs'],{env:{PATH:process.env.PATH,BRAVADO_API_KEY:key,BRAVADO_API_SECRET:secret,BRAVADO_API_ORIGIN:`http://127.0.0.1:${port}`,BRAVADO_FEED_ORIGIN:`ws://127.0.0.1:${port}`,BRAVADO_FEED_MODE:mode,BRAVADO_SAMPLE_MS:'200'}});
    let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
    const [code]=await once(child,'close');assert.equal(code,0,err);assert.equal(JSON.parse(out).synthetic,true);
    assert.ok(!out.includes(token)&&!err.includes(token)&&!out.includes(secret)&&!err.includes(secret));
  }
  assert.equal(signed,2);assert.equal(upgraded,2);
  console.log('PASS: documentation client signed both exact paths, upgraded both sockets and received frames; no credential logging (synthetic loopback)');
} finally {server.closeAllConnections();server.close();}
