import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),E=require('../src/ride-engine.js');
const ms=Date.UTC(2026,10,1),G=9.80665;
function line(speed,duration,dt){const rows=[];for(let i=0;i<=Math.round(duration/dt);i++){const t=Math.min(i*dt,duration),v=speed*(1-t/duration),s=speed/3.6*(t-t*t/(2*duration));rows.push([120+s/(111320*Math.cos(Math.PI/6)),30,v,ms+Math.round(t*1000)]);}return rows;}
const wire=a=>a.map(r=>r.join(',')).join('&');
function circle(radius,speed=40,total=180){return Array.from({length:Math.floor(total/10)+1},(_,i)=>{const a=i*10*Math.PI/180,t=radius*a/(speed/3.6);return [120+radius*Math.sin(a)/(111320*Math.cos(Math.PI/6)),30+radius*(1-Math.cos(a))/111320,speed,ms+Math.round(t*1000)];});}
function straight(dt=10){return Array.from({length:15},(_,i)=>[120+i*.0002,30,40,ms+i*dt*1000]);}
test('release and fixed published criteria',()=>{assert.equal(E.version,'2.0.0');assert.equal(E.criteria.brakeG,.3);assert.equal(E.criteria.leanDegrees,10);assert.equal(E.criteria.turnMinSpeed,10);});
test('high-frequency strong deceleration counts once',()=>{const r=E.analyze(wire(line(60,3,.2)));assert.equal(r.brakes,1);assert.equal(r.quality.brake,'estimated');});
test('slow braking is not harsh even with large speed loss',()=>assert.equal(E.analyze(wire(line(60,10,.2))).brakes,0));
test('exact threshold withstands floating point representation',()=>{const a=line(.3*G*3.6*2,2,.2);assert.equal(E.analyze(wire(a)).brakes,1);});
test('a short spike does not meet sustained duration',()=>{const a=line(10,.4,.1),last=a.at(-1);for(let i=1;i<=10;i++)a.push([...last.slice(0,3),last[3]+i*100]);assert.equal(E.analyze(wire(a)).brakes,0);});
test('coarse braking stays unknown, rather than zero or an inflated estimate',()=>{const r=E.analyze(wire(line(60,10,10)));assert.equal(r.brakes,null);assert.equal(r.quality.brake,'sparse');});
test('acceleration does not count as braking',()=>{const a=line(60,3,.2),v=a.map(p=>p[2]).reverse();a.forEach((p,i)=>p[2]=v[i]);assert.equal(E.analyze(wire(a)).brakes,0);});
test('18-second interval is retained in 10-second cadence',()=>{const a=straight();for(let i=7;i<a.length;i++)a[i][3]+=8000;assert.equal(E.analyze(wire(a)).quality.gaps,0);});
test('an 18-second cadence is itself normal',()=>assert.equal(E.analyze(wire(straight(18))).quality.gaps,0));
test('a 16-minute missing span remains separated',()=>{const a=straight();for(let i=7;i<a.length;i++)a[i][3]+=983000;const r=E.analyze(wire(a));assert.equal(r.quality.gaps,1);assert.equal(r.brakes,null);assert.equal(r.bends,0);});
test('high frequency gaps are also protected',()=>{const a=straight(1);for(let i=7;i<a.length;i++)a[i][3]+=10000;assert.equal(E.analyze(wire(a)).quality.gaps,1);});
test('sharp moving circle yields one model-qualified turn',()=>assert.equal(E.analyze(wire(circle(40))).bends,1));
test('broad curve does not meet model tilt criterion at same speed',()=>assert.equal(E.analyze(wire(circle(200))).bends,0));
test('a turn below 20kmh can qualify when geometry is tight enough',()=>assert.equal(E.analyze(wire(circle(15,19))).bends,1));
test('a very slow sharp circle is not qualified by angle alone',()=>assert.equal(E.analyze(wire(circle(40,5))).bends,0));
test('stationary coordinate drift does not create a bend',()=>{const a=circle(40).map(p=>[p[0],p[1],0,p[3]]);assert.equal(E.analyze(wire(a)).bends,0);});
test('straight GPS jitter is rejected',()=>{const a=straight();a.forEach((p,i)=>p[1]+=(i%2?1:-1)*3/111320);assert.equal(E.analyze(wire(a)).bends,0);});
test('teleports are not turns',()=>{const a=straight();a[6][1]+=1;const r=E.analyze(wire(a));assert.equal(r.bends,0);assert.equal(r.quality.gaps,2);});
test('bad samples never bridge a braking or turning event',()=>{const a=line(60,3,.2);const s=wire(a.slice(0,5))+'&bad&'+wire(a.slice(6));const r=E.analyze(s);assert.equal(r.brakes,null);assert.equal(r.quality.invalidPoints,1);});
test('empty, invalid and excessive input stay unavailable',()=>{for(const s of [null,'bad','0,0,40,123',Array(50002).fill('1,1,1,1').join('&')]){const r=E.analyze(s);assert.equal(r.brakes,null);assert.equal(r.bends,null);}});
test('second and millisecond timestamps agree',()=>{const a=circle(40),s=a.map(p=>[...p.slice(0,3),p[3]/1000]);assert.equal(E.analyze(wire(a)).bends,E.analyze(wire(s)).bends);});
