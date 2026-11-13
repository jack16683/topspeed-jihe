import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/ride-fill.js',import.meta.url),'utf8');
const tools=fs.readFileSync(new URL('../scripts/cache-tools.js',import.meta.url),'utf8');
const plugin=fs.readFileSync(new URL('../极速鸡盒.plugin',import.meta.url),'utf8');
const root='https://tapi.zeehoev.com/v1.0/app/cfmotoserverapp/';
const KEY='zeeho.ridefill.v1';
function run(endpoint,data,{store=new Map(),vin='TESTVIN12345678901',uid='a',raw,method='GET',code=10000,failWrite=false,status=200,url,headers={},forbidEstimation=false}={}) {
  const body=raw??JSON.stringify({code,data}), done=[], logs=[];
  var writes=0;
  const request={url:url??root+endpoint+'?vinNo='+vin,method,headers:{user_id:uid,...headers}};
  const response={status,body};
  const before=JSON.stringify({request,response});
  const ctx={$request:request,$response:response,$persistentStore:{read:k=>store.get(k),write:(s,k)=>{writes++;if(failWrite)return false;store.set(k,s);return true;}},$done:x=>done.push(x),console:{log:x=>logs.push(x)}};
  if(forbidEstimation) ctx.Math=new Proxy(Math,{get(target,key){
    if(['sin','cos','atan2','sqrt','round'].includes(key)) return ()=>{throw new Error('Cached ride must not run estimators');};
    return target[key];
  }});
  vm.runInNewContext(source,ctx,{timeout:2000});
  assert.equal(done.length,1); assert.equal(JSON.stringify({request,response}),before);
  var dataOut; try { dataOut=JSON.parse(done[0].body??body).data; } catch {}
  return {data:dataOut,patch:done[0],store,logs,writes};
}
const ms=Date.UTC(2026,10,12);
const speeds=[40,40,36,32,28,24,20,16,12,8,4,0,0,0,0];
const braking=(offset=0,ts=ms)=>{let x=0;return speeds.map((v,i)=>{if(i)x+=(speeds[i-1]+v)/2/3.6*.2;return [120+x/(111320*Math.cos(Math.PI/6)),30,v,ts+i*200+offset].join(',');}).join('&');};
const straight=()=>speeds.map((_,i)=>[120+i*.0002,30,40,ms+i*2000].join(',')).join('&');
function bend(){return Array.from({length:9},(_,i)=>{const a=i*15*Math.PI/180;return [120+40*Math.sin(a)/(111320*Math.cos(Math.PI/6)),30+40*(1-Math.cos(a))/111320,40,ms+i*1000].join(',');}).join('&');}
const tracks=(trajectory=braking(),id='r1',date='2026.11.12',extra={})=>[{dayTime:date,historyList:[{rideId:id,trajectory,brakesTimes:0,bendingTimes:0,...extra}]}];
const rec=r=>r.data[0].historyList[0];
function dayRun(store,date='2026-11-12',options={}){return run('myRideInfo',{rideRecordList:[{date,brakesTimesDay:'0',bendingTimesDay:'0'}],bendingTimesTotal:'0'},{store,...options});}

test('gate preserves vehicleType, only patches named display fields',()=>{
 const r=run('vehicleHomePageV2',{vehicleKinds:4,vehicleType:'AE5i',cyclingEventStatisticFlag:false});
 assert.deepEqual(r.data,{vehicleKinds:2,vehicleType:'AE5i',cyclingEventStatisticFlag:true});
 assert.equal(r.store.size,0);
});
test('vehicle home page with VIN in path rewrites vehicle kinds and event gate',()=>{
 for(const suffix of ['/TESTVIN12345678901?uniqueIdentify=test','/TESTVIN12345678901']) {
  const r=run('vehicleHomePageV2',{vehicleKinds:4,vehicleType:'MODEL',cyclingEventStatisticFlag:false},{url:root+'vehicleHomePageV2'+suffix});
  assert.deepEqual(r.data,{vehicleKinds:2,vehicleType:'MODEL',cyclingEventStatisticFlag:true});
  assert.equal(r.store.size,0);
 }
});
test('vehicle list rewrites display type for each vehicle without changing model fields',()=>{
 const r=run('vehicle/list',[{vehicleKinds:4,vehicleType:'MODEL_A',cyclingEventStatisticFlag:false},{vehicleKinds:'4',vehicleType:'MODEL_B',cyclingEventStatisticFlag:false}]);
 assert.deepEqual(r.data,[{vehicleKinds:2,vehicleType:'MODEL_A',cyclingEventStatisticFlag:true},{vehicleKinds:2,vehicleType:'MODEL_B',cyclingEventStatisticFlag:true}]);
 assert.equal(r.store.size,0);
});
test('only confirmed vehicleKinds values are rewritten and absent fields stay absent',()=>{
 const input=[1,4,'1','4',null,2,'2',0,3,5,'',false,true].map(vehicleKinds=>({vehicleKinds}));
 input.push({other:'keep'});
 const r=run('vehicle/list',input);
 assert.deepEqual(r.data.slice(0,5),Array.from({length:5},()=>({vehicleKinds:2})));
 assert.deepEqual(r.data.slice(5),input.slice(5));
 assert.ok(r.data.every(v=>!Object.hasOwn(v,'cyclingEventStatisticFlag')));
});
test('daily records recursively unlock null display fields while preserving server statistics',()=>{
 const daily={date:'2026.11.12',vehicleKinds:null,cyclingEventStatisticFlag:null,maxSpeed:52,accelerationTimesDay:'8',brakesTimesDay:'0',bendingTimesDay:'0',vehicleType:'MODEL'};
 const r=run('myRideInfo',{rideRecordList:[daily]},{code:'10000'});
 assert.deepEqual(r.data,{rideRecordList:[{...daily,vehicleKinds:2,cyclingEventStatisticFlag:true}]});
 assert.equal(r.writes,0);
});
test('historical ride display flags are rewritten while trajectory and speed stay unchanged',()=>{
 const data=tracks(straight(),'r1','2026.11.12',{vehicleKinds:null,cyclingEventStatisticFlag:null,maxSpeed:52,vehicleType:'MODEL'});
 const original=data[0].historyList[0];
 const r=run('ridetrack_v2',data);
 assert.deepEqual(rec(r),{...original,vehicleKinds:2,cyclingEventStatisticFlag:true});
 assert.equal(r.writes,1);
});
test('responses without explicit successful business code are not rewritten',()=>{
 const data={vehicleKinds:4,cyclingEventStatisticFlag:false};
 const r=run('vehicleHomePageV2',data,{raw:JSON.stringify({data})});
 assert.deepEqual(Object.keys(r.patch),[]);assert.equal(r.writes,0);
});
test('published plugin routes actual home paths and vehicle lists to the display rewrite',()=>{
 const guard=vm.runInNewContext(plugin.match(/response if \$\{url\} ~= (\/.*\/) then script/)[1]);
 for(const endpoint of ['vehicleHomePageV2','vehicleHomePageV2/TESTVIN12345678901','vehicle/list','ridetrack_v2','myRideInfo','homeRideInfo','analyse/analyse']) {
  assert.ok(guard.test(root+endpoint+'?test=1'),endpoint);
 }
 assert.equal(guard.test(root+'vehicleHomePageV2evil?test=1'),false);
 assert.equal(guard.test('https://evil.example/'+root+'vehicleHomePageV2/TESTVIN12345678901'),false);
});
test('brake estimate survives separate invocations and repeated opening never adds twice',()=>{
 const a=run('ridetrack_v2',tracks()); assert.ok(rec(a).brakesTimes>0); const count=rec(a).brakesTimes;
 run('ridetrack_v2',tracks(),{store:a.store});
 assert.equal(Number(dayRun(a.store).data.rideRecordList[0].brakesTimesDay),count);
 assert.equal(Object.values(JSON.parse(a.store.get(KEY)).scopes)[0]['2026.11.12|r1'].b,count);
 assert.equal(dayRun(a.store).data.bendingTimesTotal,'0');
});
test('turning trajectory counts bends; constant-speed straight trajectory counts neither',()=>{
 const turn=run('ridetrack_v2',tracks(bend()));assert.ok(rec(turn).bendingTimes>0);assert.equal(rec(turn).brakesTimes,0);
 const a=run('ridetrack_v2',tracks(straight()));assert.equal(rec(a).brakesTimes,0);assert.equal(rec(a).bendingTimes,0);
});
test('cached nonzero is reused before trajectory calculation and missing trajectory also reuses it',()=>{
 const a=run('ridetrack_v2',tracks());
  const count=rec(a).brakesTimes, before=a.store.get(KEY);
 assert.ok(rec(run('ridetrack_v2',tracks(undefined,'r1','2026.11.12',{trajectory:null}),{store:a.store})).brakesTimes>0);
  const hit=run('ridetrack_v2',tracks(straight()),{store:a.store,forbidEstimation:true});
  assert.equal(rec(hit).brakesTimes,count); assert.equal(hit.writes,0);
  assert.equal(a.store.get(KEY),before); assert.ok(hit.logs.some(s=>s.includes('已计算 0 条行程；复用缓存 1 条')));
  assert.equal(Number(dayRun(a.store).data.rideRecordList[0].brakesTimesDay),count);
});
test('zero estimates are cache hits too, and clearing lets the same ride be recalculated',()=>{
 const a=run('ridetrack_v2',tracks(straight()));
 const hit=run('ridetrack_v2',tracks(braking()),{store:a.store,forbidEstimation:true});
 assert.equal(rec(hit).brakesTimes,0);assert.equal(hit.writes,0);
 assert.ok(hit.logs.some(s=>s.includes('复用缓存 1 条')));
 vm.runInNewContext(tools,{$argument:'clear',$persistentStore:{write:(s,k)=>{a.store.set(k,s);return true;}},console:{log:()=>{}},$done:()=>{}});
 const fresh=run('ridetrack_v2',tracks(braking()),{store:a.store});
 assert.ok(rec(fresh).brakesTimes>0);assert.equal(fresh.writes,1);
});
test('a mixed response reuses old rides and computes only new rides without duplicating daily sums',()=>{
 const a=run('ridetrack_v2',tracks()), count=rec(a).brakesTimes;
 const data=tracks(straight());data[0].historyList.push(tracks(braking(),'r2')[0].historyList[0]);
 const mixed=run('ridetrack_v2',data,{store:a.store});
 assert.equal(rec(mixed).brakesTimes,count);assert.ok(mixed.data[0].historyList[1].brakesTimes>0);
 assert.ok(mixed.logs.some(s=>s.includes('已计算 1 条行程；复用缓存 1 条')));
 assert.equal(Number(dayRun(a.store).data.rideRecordList[0].brakesTimesDay),count+mixed.data[0].historyList[1].brakesTimes);
});
test('nonzero cloud statistics take priority for ride, day and month',()=>{
 const a=run('ridetrack_v2',tracks(braking(),'r1','2026.11.12',{brakesTimes:7,bendingTimes:'4'}));
 assert.equal(rec(a).brakesTimes,7);assert.equal(rec(a).bendingTimes,'4');
 const r=run('myRideInfo',{rideRecordList:[{date:'2026.11.12',brakesTimesDay:2,bendingTimesDay:'3'}],bendingTimesTotal:55},{store:a.store});
 assert.equal(r.data.rideRecordList[0].brakesTimesDay,2); assert.equal(r.data.rideRecordList[0].bendingTimesDay,'3');assert.equal(r.data.bendingTimesTotal,55);
 const m=run('analyse/analyse',{rideMonth:'202611',brakesTimes:3,bendingTimes:6},{store:a.store});
 assert.equal(m.data.brakesTimes,3);assert.equal(m.data.bendingTimes,6);
});
test('months and dates normalize; only target month is aggregated',()=>{
 const a=run('ridetrack_v2',tracks()); run('ridetrack_v2',tracks(braking(),'r2','2026-10-01'),{store:a.store});
 const m=run('analyse/analyse',{rideMonth:'202611',brakesTimes:'0',bendingTimes:'0'},{store:a.store});
 assert.equal(m.data.brakesTimes,dayRun(a.store).data.rideRecordList[0].brakesTimesDay);
 assert.equal(dayRun(a.store,'2026/11/12').data.rideRecordList[0].brakesTimesDay,m.data.brakesTimes);
 assert.equal(dayRun(a.store,'2026.02.30').data.rideRecordList[0].brakesTimesDay,'0');
});
test('cache is isolated by vehicle and account, unknown identity never falls back to last vehicle',()=>{
 const a=run('ridetrack_v2',tracks());
 assert.equal(dayRun(a.store,'2026.11.12',{vin:'OTHERVIN123456789'}).data.rideRecordList[0].brakesTimesDay,'0');
 assert.equal(dayRun(a.store,'2026.11.12',{uid:'b'}).data.rideRecordList[0].brakesTimesDay,'0');
 assert.equal(dayRun(a.store,'2026.11.12',{url:root+'myRideInfo'}).data.rideRecordList[0].brakesTimesDay,'0');
 const noId=run('ridetrack_v2',tracks(),{url:root+'ridetrack_v2'});assert.ok(rec(noId).brakesTimes>0);assert.equal(noId.store.size,0);
});
test('storage contains counts and identifiers, never raw coordinates, trajectory or token',()=>{
 const a=run('ridetrack_v2',tracks(),{headers:{Authorization:'Bearer TEST_SECRET'}}),s=a.store.get(KEY);
 assert.ok(s);assert.ok(!s.includes('TEST_SECRET'));assert.ok(!s.includes('120.'));assert.ok(!s.includes('trajectory'));
});
test('seconds and milliseconds timestamps produce equal estimates',()=>{
 const sec=braking().split('&').map(p=>{const a=p.split(',');a[3]=String(Number(a[3])/1000);return a.join(',');}).join('&');
 assert.equal(rec(run('ridetrack_v2',tracks(sec))).brakesTimes,rec(run('ridetrack_v2',tracks())).brakesTimes);
});
test('invalid points, long gaps and reversed timestamps do not bridge into false braking events',()=>{
 const samples=braking().split('&');
 for(const bad of ['garbage','120,30,,123','0,0,40,123','Infinity,30,40,123']) {
  const t=[...samples.slice(0,3),bad,...samples.slice(5)].join('&');
  const a=run('ridetrack_v2',tracks(t)); assert.equal(rec(a).brakesTimes,0); assert.equal(Object.values(JSON.parse(a.store.get(KEY)).scopes)[0]['2026.11.12|r1'].b,null);
 }
 const gap=braking().split('&').map((p,i)=>{const a=p.split(',');a[3]=String(ms+i*30000);return a.join(',');}).join('&');
 assert.equal(Object.values(JSON.parse(run('ridetrack_v2',tracks(gap)).store.get(KEY)).scopes)[0]['2026.11.12|r1'].b,null);
 const reversed=samples.reverse().join('&');assert.equal(Object.values(JSON.parse(run('ridetrack_v2',tracks(reversed)).store.get(KEY)).scopes)[0]['2026.11.12|r1'].b,null);
});
test('malformed JSON, HTTP/business errors, foreign host, endpoint suffix and writes pass through',()=>{
 for(const opts of [{raw:'not json'},{code:401},{status:403},{method:'POST'},{url:'https://evil.example/?x='+root+'ridetrack_v2'},{url:root+'ridetrack_v2evil'}]) {
  const a=run('ridetrack_v2',tracks(),opts);assert.deepEqual(Object.keys(a.patch),[]);assert.equal(a.store.size,0);
 }
 const a=run('homeRideInfo',{}, {raw:'{ "code":10000, "data":{ "lastRideMileage":5 } }'});assert.deepEqual(Object.keys(a.patch),[]);
});
test('failed persistence is reported without losing response or calling done twice',()=>{
 const a=run('ridetrack_v2',tracks(),{failWrite:true});assert.ok(rec(a).brakesTimes>0);assert.equal(a.store.size,0);assert.ok(a.logs.some(x=>x.includes('失败')));
});
test('home backfill requires matching ride ID or explicit day with existing daily fields',()=>{
 const a=run('ridetrack_v2',tracks());
 const r=run('homeRideInfo',{rideId:'r1',brakesTimes:0,bendingTimes:0},{store:a.store});assert.ok(r.data.brakesTimes>0);
 const daily=run('homeRideInfo',{date:'2026.11.12',brakesTimesDay:'0'},{store:a.store});assert.ok(Number(daily.data.brakesTimesDay)>0);
 const noDate=run('homeRideInfo',{brakesTimesDay:0},{store:a.store});assert.equal(noDate.data.brakesTimesDay,0);
});
test('manual cache tools show summary and clear only this plugin cache',()=>{
 const a=run('ridetrack_v2',tracks());a.store.set('other.plugin','keep');
 function tool(mode){const done=[],notices=[];vm.runInNewContext(tools,{$argument:mode,$persistentStore:{read:k=>a.store.get(k),write:(s,k)=>{a.store.set(k,s);return true;}},$notification:{post:(...x)=>notices.push(x)},console:{log:()=>{}},$done:x=>done.push(x)});assert.equal(done.length,1);return notices[0][2];}
 assert.match(tool('status'),/已缓存行程：1/);tool('clear');assert.equal(a.store.get('other.plugin'),'keep');assert.match(tool('status'),/已缓存行程：0/);
});

test('sparse braking preserves original cloud value and caches unknown separately',()=>{
 const a=run('ridetrack_v2',tracks(straight()));
 assert.equal(rec(a).brakesTimes,0);
 const db=JSON.parse(a.store.get(KEY));assert.equal(db.version,2);assert.equal(db.algorithm,'2.0.0');assert.equal(Object.values(db.scopes)[0]['2026.11.12|r1'].b,null);
 assert.equal(dayRun(a.store).data.rideRecordList[0].brakesTimesDay,'0');
});
test('unavailable braking field is not created as a fabricated zero',()=>{
 const data=tracks(straight());delete data[0].historyList[0].brakesTimes;
 const a=run('ridetrack_v2',data);assert.equal(Object.hasOwn(rec(a),'brakesTimes'),false);
});
test('old algorithm cache is replaced once and never mixed with new sums',()=>{
 const old={version:1,scopes:{'a|TESTVIN12345678901':{'2026.11.12|r1':{id:'r1',day:'2026.11.12',b:99,d:88}}}};
 const store=new Map([[KEY,JSON.stringify(old)]]);
 const fresh=run('ridetrack_v2',tracks(),{store});assert.equal(rec(fresh).brakesTimes,1);assert.equal(fresh.writes,1);
 const again=run('ridetrack_v2',tracks(),{store,forbidEstimation:true});assert.equal(rec(again).brakesTimes,1);assert.equal(again.writes,0);
 assert.equal(dayRun(store).data.rideRecordList[0].brakesTimesDay,'1');
});
test('unknown mixed with known braking does not fabricate a complete daily total',()=>{
 const a=run('ridetrack_v2',tracks());run('ridetrack_v2',tracks(straight(),'r2'),{store:a.store});
 assert.equal(dayRun(a.store).data.rideRecordList[0].brakesTimesDay,'0');
});
test('new authoritative cloud counts update cache without recomputing the trajectory',()=>{
 const a=run('ridetrack_v2',tracks());
 const update=run('ridetrack_v2',tracks(straight(),'r1','2026.11.12',{brakesTimes:9,bendingTimes:3}),{store:a.store,forbidEstimation:true});
 assert.equal(rec(update).brakesTimes,9);assert.equal(update.writes,1);assert.equal(dayRun(a.store).data.rideRecordList[0].brakesTimesDay,'9');
});
test('status distinguishes unknown sampling and expired cache',()=>{
 const a=run('ridetrack_v2',tracks(straight()));
 function status(store){const logs=[];vm.runInNewContext(tools,{$persistentStore:{read:k=>store.get(k)},console:{log:x=>logs.push(x)},$done:()=>{}});return logs.join('');}
 assert.match(status(a.store),/急刹采样不足：1 条/);
 assert.match(status(new Map([[KEY,JSON.stringify({version:1,scopes:{}})]])),/旧算法缓存已过期/);
});
test('available bend estimates can contribute without treating unavailable geometry as zero',()=>{
 const a=run('ridetrack_v2',tracks(bend()));
 const unmoving=Array.from({length:6},(_,i)=>[120,30,0,ms+i*10000].join(',')).join('&');
 run('ridetrack_v2',tracks(unmoving,'r2'),{store:a.store});
 const db=JSON.parse(a.store.get(KEY));assert.equal(Object.values(db.scopes)[0]['2026.11.12|r2'].d,null);
 assert.equal(Number(dayRun(a.store).data.rideRecordList[0].bendingTimesDay),rec(a).bendingTimes);
 assert.equal(Number(run('analyse/analyse',{rideMonth:'202611',bendingTimes:'0'},{store:a.store}).data.bendingTimes),rec(a).bendingTimes);
});
