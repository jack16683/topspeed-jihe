// Uses the official Loon website packager already present on this machine.
// Set LOON_PACKAGER_DIR to a directory with pluginEncryption.mjs and publicKey.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const dir=process.env.LOON_PACKAGER_DIR;
if(!dir) throw new Error('Set LOON_PACKAGER_DIR to the official Loon packager directory.');
const {readPluginInput,analyzePlugin,encryptPluginPackage}=await import(pathToFileURL(path.join(dir,'pluginEncryption.mjs')));
const names=['极速鸡盒.plugin','scripts/ride-fill.js','scripts/cache-tools.js'];
const files=names.map(p=>{const f=new File([fs.readFileSync(path.join('loon',p))],path.basename(p));Object.defineProperty(f,'webkitRelativePath',{value:'plugin/'+p});return f;});
const state=await readPluginInput(files,{directory:true});
const analysis=analyzePlugin(state.entries,names[0]);
assert.deepEqual(analysis.errors,[]);assert.equal(analysis.references.length,3);
assert.ok(analysis.references.every(r=>r.source==='package'));
const native=crypto.webcrypto, checks=[];
const validating={getRandomValues:native.getRandomValues.bind(native),subtle:new Proxy(native.subtle,{get(target,prop){
  if(prop==='importKey')return async(format,data,algorithm,extractable,usages)=>target.importKey(format,data,algorithm,extractable,(typeof algorithm==='string'?algorithm:algorithm.name)==='AES-GCM'?[...new Set([...usages,'decrypt'])]:usages);
  if(prop==='encrypt')return async(algorithm,key,data)=>{const original=new Uint8Array(data).slice();const result=await target.encrypt(algorithm,key,data);if(algorithm.name==='AES-GCM'){assert.deepEqual(new Uint8Array(await target.decrypt(algorithm,key,result)),original);checks.push(original.length);}return result;};
  const value=target[prop];return typeof value==='function'?value.bind(target):value;
}})};
globalThis.fetch=()=>{throw new Error('Network disabled while packaging');};
const config=JSON.parse(fs.readFileSync(path.join(dir,'publicKey.json'),'utf8'));
const bytes=Buffer.from(await encryptPluginPackage(state.entries,names[0],config,validating));
assert.equal(bytes.subarray(0,4).toString(),'LPXE');assert.equal(bytes[4],2);assert.equal(checks.length,3);
fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/极速鸡盒.lpxe',bytes);
const report={format:'LPXE v2',bundledScripts:2,remoteResources:0,aesRoundTrips:checks.length,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),referenceCommit:'bd17ef6e9ad01ec135aeba8666391e1e259a8234',offlineTests:16,cachePolicy:'reuse-existing-including-zero',deviceValidated:false};
fs.writeFileSync('outputs/validation.json',JSON.stringify(report,null,2)+'\n');console.log(report);
