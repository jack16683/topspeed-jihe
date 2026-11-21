/* SPDX-License-Identifier: AGPL-3.0-only */
(function () {
'use strict';
var E=JiheRideEngine, own=function(o,k){return Object.prototype.hasOwnProperty.call(o,k);};
var P=E.profile(typeof $argument==='object'&&$argument?$argument:{});
var KEY='zeeho.ridefill.v1',MAX_RIDES=2000,MAX_CHARS=900000;
function log(s){console.log('[极速鸡盒] '+s);}
function missing(v){return v===undefined||v===null||v===''||v===0||v==='0';}
function number(v){if(v===null||v===undefined||String(v).trim()==='')return NaN;var n=Number(v);return isFinite(n)?n:NaN;}
function validCount(v){return typeof v==='number'&&isFinite(v)&&v>=0&&Math.floor(v)===v;}
function day(v){var m=/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:$|[ T])/.exec(String(v||''));if(!m)return '';var y=+m[1],mo=+m[2],d=+m[3],dt=new Date(Date.UTC(y,mo-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return '';return m[1]+'.'+('0'+mo).slice(-2)+'.'+('0'+d).slice(-2);}
function month(v){var m=/^(\d{4})[.\/-]?(\d{2})$/.exec(String(v||''));return m&&+m[2]>=1&&+m[2]<=12?m[1]+'.'+m[2]:'';}
function query(url) {
  var result=Object.create(null), q=(url.split('?')[1] || '').split('#')[0].split('&');
  for(var i=0;i<q.length;i++) {
    var p=q[i].split('=');
    try { result[decodeURIComponent(p[0])]=decodeURIComponent(p.slice(1).join('=').replace(/\+/g,' ')); } catch(e) {}
  }
  return result;
}
function identity(req, q, data) {
  var vin=q.vinNo || q.vin || (data && !Array.isArray(data) && (data.vinNo || data.vin));
  if(typeof vin!=='string' || !/^[A-Za-z0-9_-]{6,64}$/.test(vin)) return '';
  var headers=req.headers || {}, uid='';
  Object.keys(headers).forEach(function(k) {
    if(/^(user_id|userid|user-id)$/i.test(k)) uid=String(headers[k]);
  });
  // No bearer token, location or full URL is persisted.
  return encodeURIComponent(uid)+'|'+encodeURIComponent(vin);
}
function load() {
  try {
    var s=$persistentStore.read(KEY), o=s && JSON.parse(s);
    if(o && o.version===2 && o.algorithm===E.version && o.scopes && typeof o.scopes==='object' && !Array.isArray(o.scopes)) return o;
  } catch(e) { log('缓存不可读，本次从空缓存开始'); }
  return {version:2,algorithm:E.version,lastProfile:P.key,scopes:{}};
}
function save(db) {
  var s=JSON.stringify(db), count=0;
  Object.keys(db.scopes).forEach(function(k) { count+=Object.keys(db.scopes[k]).length; });
  if(count>MAX_RIDES || s.length>MAX_CHARS) { log('缓存已满，本次只补全行程；请手动清空缓存后重建'); return; }
  try { if(!$persistentStore.write(s,KEY)) log('缓存保存失败，本次估算未持久化'); }
  catch(e) { log('缓存保存失败，本次估算未持久化'); }
}
function fill(obj,key,value) {
  if(validCount(value) && missing(obj[key])) {
    obj[key]=typeof obj[key]==='string' ? String(value) : value;
  }
}
function gate(obj,depth) {
  if(!obj || typeof obj!=='object' || depth>8) return;
  var kinds=obj.vehicleKinds;
  if(own(obj,'vehicleKinds') && (kinds===1 || kinds===4 || kinds==='1' || kinds==='4' || kinds===null)) obj.vehicleKinds=2;
  if(own(obj,'cyclingEventStatisticFlag')) obj.cyclingEventStatisticFlag=true;
  Object.keys(obj).forEach(function(k) { if(obj[k] && typeof obj[k]==='object') gate(obj[k],depth+1); });
}
function gateVehicleResponse(raw,obj,original) {
  // The App reuses numeric IDs from these responses in later requests.
  // Keep oversized integer literals out of JSON.parse's Number conversion.
  var prefix='__jihe_exact_integer_', literals=Object.create(null), count=0;
  while(original.indexOf(prefix)!==-1) prefix+='_';
  var tokens=/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  var protectedBody=raw.replace(tokens,function(token) {
    if(!/^-?\d{16,}$/.test(token) || Number.isSafeInteger(Number(token))) return token;
    var marker=JSON.stringify(prefix+(count++));
    literals[marker]=token;
    return marker;
  });
  if(count) {
    obj=JSON.parse(protectedBody);
    original=JSON.stringify(obj);
  }
  gate(obj.data,0);
  var gated=JSON.stringify(obj);
  if(gated===original) return {};
  if(count) {
    gated=gated.replace(/"(?:[^"\\]|\\[\s\S])*"/g,function(token) {
      return own(literals,token) ? literals[token] : token;
    });
  }
  return {body:gated};
}
function sums(rides,date,prefix) {
  var b=0,d=0,n=0,bKnown=true,dKnown=false;
  Object.keys(rides).forEach(function(k) {
    var r=rides[k];
    if(r && (prefix ? r.day.slice(0,7)===date : r.day===date)) { if(validCount(r.b))b+=r.b;else bKnown=false;if(validCount(r.d)){d+=r.d;dKnown=true;}n++; }
  });
  return {b:bKnown?b:null,d:dKnown?d:null,n:n};
}
function fillDay(rec,date,rides) {
  var ds=day(date); if(!ds) return;
  var s=sums(rides,ds,false); if(!s.n) return;
  if(s.b>0) fill(rec,'brakesTimesDay',s.b);
  if(s.d>0) fill(rec,'bendingTimesDay',s.d);
}
function cachedRide(rec,rides,date,changes) {
  var id=rec.rideId || rec.id || rec.ride_no || rec.recordId;
  if(id===undefined || id===null || id==='') return false;
  var ds=day(rec.dayTime || rec.date || date), c=null;
  if(ds) {
    var key=ds+'|'+String(id);
    if(own(rides,key)) c=rides[key];
  } else {
    var matches=Object.keys(rides).filter(function(k) { return rides[k].id===String(id); });
    if(matches.length===1) c=rides[matches[0]];
  }
  if(!c || !(c.b===null||validCount(c.b)) || !(c.d===null||validCount(c.d))) return false;
  if(changes){var cb=number(rec.brakesTimes),cd=number(rec.bendingTimes);if(cb>0&&validCount(cb)&&c.b!==cb){c.b=cb;changes.dirty=true;}if(cd>0&&validCount(cd)&&c.d!==cd){c.d=cd;changes.dirty=true;}}
  fill(rec,'brakesTimes',c.b); fill(rec,'bendingTimes',c.d);
  return true;
}
function main() {
  var req=typeof $request==='undefined' ? {} : $request;
  var res=typeof $response==='undefined' ? {} : $response;
  var url=req.url || '';
  var match=/^https:\/\/tapi\.zeehoev\.com\/v1\.0\/app\/cfmotoserverapp\/(?:[^/?#]+\/)*(vehicleHomePageV2(?:\/[^/?#]+)?|vehicle\/list|ridetrack_v2|myRideInfo|homeRideInfo|analyse)(?:\?|$)/.exec(url);
  if(!match || (req.method && String(req.method).toUpperCase()!=='GET')) return {};
  var status=String(res.statusCode || res.status || '200');
  if(!/^(200|HTTP\/\S+ 200(?:\s.*)?)$/.test(status)) return {};
  if(typeof res.body!=='string' || res.body.length>8000000) return {};
  var obj=JSON.parse(res.body);
  if(!obj || typeof obj!=='object' || String(obj.code)!=='10000') return {};
  var original=JSON.stringify(obj);
  var data=obj.data, type=match[1]; if(!data || typeof data!=='object') return {};
  if(type.indexOf('vehicleHomePageV2/')===0) type='vehicleHomePageV2';
  if(type==='vehicleHomePageV2' || type==='vehicle/list') return gateVehicleResponse(res.body,obj,original);
  if(type==='myRideInfo' || type==='ridetrack_v2') gate(data,0);
  var q=query(url), scope=identity(req,q,data), db=load();
  var scoped=scope?P.key+'|'+scope:'';
  var rides=scoped && own(db.scopes,scoped) ? db.scopes[scoped] : {};
  var metaChanged=!!scope&&db.lastProfile!==P.key;
  var dirty=false, computed=0, reused=0,changes={dirty:false};
  if(type==='ridetrack_v2' && Array.isArray(data)) {
    data.forEach(function(group) {
      if(!group || !Array.isArray(group.historyList)) return;
      group.historyList.forEach(function(r) {
        if(!r || typeof r!=='object') return;
        // Reuse even zero estimates before parsing or scanning the trajectory.
        if(cachedRide(r,rides,group.dayTime,changes)) { reused++; return; }
        var result=E.analyze(r.trajectory,P);
        if(result.points<4) return;
        fill(r,'brakesTimes',result.brakes);fill(r,'bendingTimes',result.bends);computed++;
        var ds=day(r.dayTime || group.dayTime), id=r.rideId || r.id || r.recordId;
        if(!scope || !ds || id===undefined || id===null || id==='') return;
        // Only uncached rides reach estimation and persistence.
        rides[ds+'|'+String(id)]={id:String(id),day:ds,b:number(r.brakesTimes)>0&&validCount(number(r.brakesTimes))?number(r.brakesTimes):result.brakes,d:number(r.bendingTimes)>0&&validCount(number(r.bendingTimes))?number(r.bendingTimes):result.bends,q:{brake:result.quality.brake,bend:result.quality.bend}};
        dirty=true;
      });
    });
    if(dirty||changes.dirty||metaChanged) { db.scopes[scoped]=rides;db.lastProfile=P.key;save(db); }
    log('已计算 '+computed+' 条行程；复用缓存 '+reused+' 条'+(!scope ? '；缺少车辆标识，未缓存' : ''));
  } else if(type==='myRideInfo') {
    if(Array.isArray(data.rideRecordList)) data.rideRecordList.forEach(function(r) {
      if(r && typeof r==='object') fillDay(r,r.date,rides);
    });
    // All-time totals cannot be reconstructed from a loaded subset of rides.
  } else if(type==='homeRideInfo') {
    // Only backfill existing known fields with an explicit response date or ride ID.
    cachedRide(data,rides);
    if(own(data,'brakesTimesDay') || own(data,'bendingTimesDay')) fillDay(data,data.date || data.dayTime,rides);
  } else if(type==='analyse') {
    var m=month(data.rideMonth); if(m) {
      var total=sums(rides,m,true);
      if(total.n) {
        if(total.b>0) fill(data,'brakesTimes',total.b);
        if(total.d>0) fill(data,'bendingTimes',total.d);
      }
    }
  }
  if(type!=='ridetrack_v2'&&metaChanged){db.lastProfile=P.key;save(db);}
  var body=JSON.stringify(obj); return body===original ? {} : {body:body};
}
var result={};
try { result=main(); }
catch(e) { log('响应或缓存格式不支持，原样放行'); }
$done(result);
})();
