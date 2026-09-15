import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {signHeaders,bravadoFetch} from './bravado-auth.mjs';
const timestamp='1700000000000';
for (const [method,body] of [['GET',''],['POST','{"name":"café"}']]) {
 const signed=signHeaders('https://partner-api.bravadotrade.com/a%20b/?z=a+b&a=%21',method,body,'key','secret',timestamp);
 const payload=[timestamp,method,'/a b?a=%21&z=a%20b',createHash('sha256').update(body).digest('hex')].join('\n');
 assert.equal(signed['X-BRAVADO-SIGNATURE'],createHmac('sha256','secret').update(payload).digest('hex'));
}
assert.throws(()=>signHeaders('https://example.com','GET','','key','secret'));
assert.throws(()=>signHeaders('https://partner-api.bravadotrade.com/?a=1&a=2','GET','','key','secret'));
process.env.BRAVADO_API_KEY='key';process.env.BRAVADO_API_SECRET='secret';
globalThis.fetch=async (url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.body,'{"size":2}');assert.ok(options.headers.get('X-BRAVADO-SIGNATURE'));assert.equal(options.headers.get('Authorization'),null);return new Response('{}');};
await bravadoFetch('https://partner-api.bravadotrade.com/v2/trade/order',{method:'POST',body:'{"size":2}'});
console.log('Node signing: GET, JSON, canonical query, origin guard, duplicate query and fetch body passed');
