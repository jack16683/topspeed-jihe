/* SPDX-License-Identifier: AGPL-3.0-only
 * Earlier releases incorporated geometry from RyanYuFish/SpeedHunter-iOS,
 * bd17ef6e9ad01ec135aeba8666391e1e259a8234. Standard geodesic helpers and
 * the time/curvature estimators below are maintained as part of this project.
 */
(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.JiheRideEngine=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var VERSION='2.1.0',G=9.80665,DEG=Math.PI/180;
var C={gapCadences:2.5,gapMin:5,gapMax:60,anchorMeters:20,turnAngle:30,noiseMeters:8,reversalAngle:12,quietAngle:4,quietMeters:90,turnMinSpeed:10,leanDegrees:5,brakeG:.3,brakeDuration:.6,brakeSampleMax:.25};
function profile(options){options=options||{};var b=options.brakeMode==='云端近似'||options.brakeMode==='cloud-like'?'cloud-like':'strict',d=options.bendMode==='保守估算'||options.bendMode==='conservative'?'conservative':'daily';return {brakeMode:b,bendMode:d,leanDegrees:d==='conservative'?10:5,key:b+'-'+d};}
function cloudCounter(prepared,cadence,parsed){
 // Count fit to historical provider counters. This is not a physical 0.3 G detector.
 if(parsed.invalid||parsed.points<4||cadence<5||cadence>20)return null;
 var n=0;
 for(var j=0;j<prepared.runs.length;j++)for(var i=1;i<prepared.runs[j].length;i++){
  var a=prepared.runs[j][i-1],b=prepared.runs[j][i],dt=(b.t-a.t)/1000,dv=a.v-b.v,g=dv/3.6/dt/G;
  if(a.v>=10&&dv+1e-9>=5&&g+1e-9>=.02)n++;
 }
 return Math.round(n*.875);
}
function finite(v){return typeof v==='number'&&isFinite(v);}
function number(v){return v===null||v===undefined||String(v).trim()===''?NaN:Number(v);}
function timestamp(v){var t=number(v);return t>=100000000&&t<100000000000?t*1000:t;}
function parse(s){
 var out=[],run=[],invalid=0,n=0;
 if(typeof s!=='string'||s.length>4000000)return {runs:[],invalid:0,points:0};
 var parts=s.split('&');if(parts.length>50000)return {runs:[],invalid:1,points:0};
 function flush(){if(run.length)out.push(run);run=[];}
 for(var i=0;i<parts.length;i++){
  if(!parts[i])continue;
  var p=parts[i].split(','),lon=number(p[0]),lat=number(p[1]),v=number(p[2]),t=timestamp(p[3]);
  if(p.length<4||!finite(lon)||!finite(lat)||!finite(v)||!finite(t)||Math.abs(lon)>180||Math.abs(lat)>90||(lon===0&&lat===0)||v<0||v>200||t<0){invalid++;flush();continue;}
  run.push({lon:lon,lat:lat,v:v,t:t});n++;
 }
 flush();return {runs:out,invalid:invalid,points:n};
}
function distance(a,b){var la=a.lat*DEG,lb=b.lat*DEG,dl=(b.lon-a.lon)*DEG,h=Math.pow(Math.sin((lb-la)/2),2)+Math.cos(la)*Math.cos(lb)*Math.pow(Math.sin(dl/2),2);h=Math.max(0,Math.min(1,h));return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function bearing(a,b){var la=a.lat*DEG,lb=b.lat*DEG,d=(b.lon-a.lon)*DEG;return Math.atan2(Math.sin(d)*Math.cos(lb),Math.cos(la)*Math.sin(lb)-Math.sin(la)*Math.cos(lb)*Math.cos(d))/DEG;}
function delta(a,b){return ((b-a+540)%360)-180;}
function median(a){a.sort(function(x,y){return x-y;});var n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;}
function timing(runs){var dt=[];for(var j=0;j<runs.length;j++)for(var i=1;i<runs[j].length;i++){var d=(runs[j][i].t-runs[j][i-1].t)/1000;if(d>0&&d<=120)dt.push(d);}var typical=dt.length?median(dt):10;return {cadence:typical,gap:Math.max(C.gapMin,Math.min(C.gapMax,typical*C.gapCadences))};}
function prepare(parsed,timing){
 var out=[],gaps=parsed.invalid,teleports=0;
 for(var j=0;j<parsed.runs.length;j++){
  var run=[],pts=parsed.runs[j];
  for(var i=0;i<pts.length;i++){
   var p=pts[i],a=run[run.length-1];
   if(a){var dt=(p.t-a.t)/1000,d=distance(a,p),jump=dt>0&&d>50&&d/dt>Math.max(120/3.6,Math.max(a.v,p.v)/3.6*2+10);
    if(dt<=0||dt>timing.gap||jump){gaps++;if(jump)teleports++;if(run.length>=2)out.push(run);run=[];}}
   run.push(p);
  }
  if(run.length>=2)out.push(run);
 }
 return {runs:out,gaps:gaps,teleports:teleports};
}
function brakeReview(prepared){
 var duration=0,intervals=0,count=0,maxG=0,sufficient=prepared.gaps===0;
 for(var j=0;j<prepared.runs.length;j++){
  var pts=prepared.runs[j],active=0;
  function flush(){if(active+1e-9>=C.brakeDuration)count++;active=0;}
  for(var i=1;i<pts.length;i++){
   var dt=(pts[i].t-pts[i-1].t)/1000,g=Math.max(0,(pts[i-1].v-pts[i].v)/3.6/dt/G);intervals++;duration+=dt;maxG=Math.max(maxG,g);
   if(dt>C.brakeSampleMax){sufficient=false;flush();continue;}
   if(g+1e-9>=C.brakeG)active+=dt;else flush();
  }
  flush();
 }
 sufficient=sufficient&&intervals>0&&duration+1e-9>=C.brakeDuration;
 return {count:sufficient?count:null,status:sufficient?'estimated':'sparse',maxAverageG:maxG};
}
function anchors(pts){var a=[{p:pts[0],path:0}],path=0;for(var i=1;i<pts.length;i++){path+=distance(pts[i-1],pts[i]);if(distance(a[a.length-1].p,pts[i])>=C.anchorMeters)a.push({p:pts[i],path:path});}return a;}
function strength(a,i){
 if(i<1||i>=a.length-1)return null;
 var p=a[i-1].p,q=a[i].p,r=a[i+1].p;
 var cos=Math.cos(q.lat*DEG),x=(p.lon-q.lon)*DEG*6371000*cos,y=(p.lat-q.lat)*DEG*6371000,X=(r.lon-q.lon)*DEG*6371000*cos,Y=(r.lat-q.lat)*DEG*6371000;
 var A=Math.sqrt(x*x+y*y),B=Math.sqrt(X*X+Y*Y),L=Math.sqrt((x-X)*(x-X)+(y-Y)*(y-Y)),product=A*B*L;
 if(product<=0)return null;
 var curvature=2*Math.abs(x*Y-y*X)/product,lateralG=Math.pow(q.v/3.6,2)*curvature/G;
 return {speed:q.v,degrees:Math.atan(lateralG)/DEG};
}
function bendReview(pts,pref){
 var a=anchors(pts),cur=null,events=[],geometry=a.length>=3;
 function flush(){if(cur&&cur.peak>=cur.required&&cur.speed>=5)events.push(cur.marker);cur=null;}
 for(var i=1;i<a.length-1;i++){
  var p=a[i-1].p,q=a[i].p,r=a[i+1].p,d=delta(bearing(p,q),bearing(q,r)),noise=Math.atan2(C.noiseMeters,Math.min(distance(p,q),distance(q,r)))/DEG;
  var speed=Math.max(p.v,q.v,r.v),required=Math.max(C.turnAngle,2*noise),reversal=Math.max(C.reversalAngle,noise);
  if(speed<5||(p.v+q.v)/2<3||(q.v+r.v)/2<3){flush();continue;}
  if(!cur){if(Math.abs(d)<1)continue;cur={sign:d>0?1:-1,net:0,peak:0,required:required,speed:speed,progress:0,lastProgress:a[i].path,streak:0,marker:i,peakStep:0};}
  if(d*cur.sign>=.5)cur.streak++;else if(d*cur.sign<=-.5)cur.streak=0;
  if(d*cur.sign>0&&Math.abs(d)>cur.peakStep){cur.peakStep=Math.abs(d);cur.marker=i;}
  cur.net+=d*cur.sign;cur.speed=Math.max(cur.speed,speed);cur.required=Math.max(cur.required,required);
  if(cur.net>cur.peak)cur.peak=cur.net;
  if(cur.peak-cur.progress>=C.quietAngle){cur.progress=cur.peak;cur.lastProgress=a[i].path;}
  if(cur.streak>=3)cur.lastProgress=a[i].path;
  var retreat=cur.peak-cur.net;
  if(retreat>=reversal){var oldSign=cur.sign;flush();cur={sign:-oldSign,net:retreat,peak:retreat,required:required,speed:speed,progress:retreat,lastProgress:a[i].path,streak:0,marker:i,peakStep:Math.abs(d)};}
  else if(cur.peak>=cur.required&&a[i].path-cur.lastProgress>=C.quietMeters)flush();
 }
 flush();var count=0;
 for(var k=0;k<events.length;k++){var s=strength(a,events[k]);if(s&&s.speed>=C.turnMinSpeed&&s.degrees>=pref.leanDegrees)count++;}
 return {count:count,geometry:geometry,turns:events.length};
}
function analyze(trajectory,options){
 var pref=profile(options);
 var parsed=parse(trajectory),t=timing(parsed.runs),prepared=prepare(parsed,t),b=brakeReview(prepared),count=0,geometry=false,turns=0;
 for(var i=0;i<prepared.runs.length;i++){var d=bendReview(prepared.runs[i],pref);count+=d.count;geometry=geometry||d.geometry;turns+=d.turns;}
 if(pref.brakeMode==='cloud-like'&&b.count===null){b.count=cloudCounter(prepared,t.cadence,parsed);b.status=b.count===null?'calibration-unavailable':'cloud-like';}
 return {version:VERSION,profile:pref.key,points:parsed.points,brakes:b.count,bends:geometry?count:null,quality:{brake:b.status,bend:geometry?'model':'insufficient',cadenceSeconds:t.cadence,gaps:prepared.gaps,invalidPoints:parsed.invalid,turnCandidates:turns,maxAverageBrakeG:b.maxAverageG}};
}
return {version:VERSION,criteria:C,profile:profile,analyze:analyze};
});
