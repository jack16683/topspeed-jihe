/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Geometry / event estimators adapted from RyanYuFish/SpeedHunter-iOS,
 * commit bd17ef6e9ad01ec135aeba8666391e1e259a8234 (ride estimators).
 * Loon adaptation: validated trajectories, scoped persistent cache, idempotent
 * updates, preservation of cloud statistics, and exact response endpoint guards.
 */
(function () {
'use strict';
var C = {
  V_MIN:15, WIN_LARGE:5, WIN_SMALL:3, DV_LARGE:15, DV_SMALL:20,
  A_MIN:0.5, MERGE_GAP:5, MIN_DUR:1.5, CALIB_FACTOR:2.5,
  BEND_V_MIN:20, BEND_V_MAX:80, BEND_SEED:5, BEND_STEP_MAX:45,
  BEND_CUM_MIN:15, BEND_CUM_CAP:90, BEND_RUN_MIN:1,
  BEND_ALLOW_GAP:0, BEND_MERGE_GAP:0, BEND_SEG_DIST_MIN:6,
  BEND_GAP_MS_MAX:25000, BEND_COEF:1
};
var own = function(o,k) { return Object.prototype.hasOwnProperty.call(o,k); };
var KEY = 'zeeho.ridefill.v1';
var MAX_RIDES = 2000, MAX_CHARS = 900000;
function log(s) { console.log('[极速鸡盒] ' + s); }
function missing(v) { return v === undefined || v === null || v === '' || v === 0 || v === '0'; }
function number(v) {
  if (v === null || v === undefined || String(v).trim() === '') return NaN;
  var n = Number(v); return isFinite(n) ? n : NaN;
}
function day(v) {
  var m = /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:$|[ T])/.exec(String(v || ''));
  if (!m) return '';
  var y=+m[1], mo=+m[2], d=+m[3], dt=new Date(Date.UTC(y,mo-1,d));
  if (dt.getUTCFullYear()!==y || dt.getUTCMonth()!==mo-1 || dt.getUTCDate()!==d) return '';
  return m[1]+'.'+('0'+mo).slice(-2)+'.'+('0'+d).slice(-2);
}
function month(v) {
  var m=/^(\d{4})[.\/-]?(\d{2})$/.exec(String(v || ''));
  return m && +m[2]>=1 && +m[2]<=12 ? m[1]+'.'+m[2] : '';
}
function timestamp(v) {
  var t=number(v); if (!isFinite(t) || t<0) return NaN;
  // Real Unix seconds and milliseconds; small relative timestamps stay in ms.
  return t>=100000000 && t<100000000000 ? t*1000 : t;
}
// Invalid samples split segments: never join across bad GPS or time gaps.
function parseTraj(traj) {
  if (typeof traj!=='string' || traj.length>4000000) return [];
  var out=[], cur=[], last=null, parts=traj.split('&');
  function split() { if(cur.length>=4) out.push(cur); cur=[]; last=null; }
  for(var i=0;i<parts.length;i++) {
    if (!parts[i]) continue;
    var p=parts[i].split(','), lon=number(p[0]), lat=number(p[1]), v=number(p[2]), t=timestamp(p[3]);
    if(p.length<4 || !isFinite(lon) || !isFinite(lat) || !isFinite(v) || !isFinite(t) ||
       Math.abs(lon)>180 || Math.abs(lat)>90 || (lon===0 && lat===0) || v<0 || v>200) { split(); continue; }
    var pt={lon:lon,lat:lat,v:v,t:t};
    if(last && (t<=last.t || t-last.t>C.BEND_GAP_MS_MAX)) split();
    cur.push(pt); last=pt;
  }
  split(); return out;
}
function bearing(lon1, lat1, lon2, lat2) {
  var y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
          Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.cos((lon2 - lon1) * Math.PI / 180);
  return Math.atan2(y, x) * 180 / Math.PI;
}
function angDiff(a, b) { var d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
function mid(a, b) { return a + angDiff(a, b) / 2; }
function distM(lon1, lat1, lon2, lat2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---- 急刹 countBrakes（固定）----
function countBrakes(pts) {
  var n = pts.length; if (n < 4) return 0;
  var cands = [], i, j;
  function scan(win, dvMin) {
    for (var i = 0; i <= n - win; i++) {
      if (pts[i].v < C.V_MIN) continue;
      var maxV = -Infinity, maxIdx = i, minV = Infinity, minIdx = i;
      for (var j = i + 1; j <= i + win && j < n; j++) {
        if (pts[j].v > maxV) { maxV = pts[j].v; maxIdx = j; }
        if (pts[j].v < minV) { minV = pts[j].v; minIdx = j; }
      }
      var dv = maxV - minV;
      if (dv < dvMin) continue;
      if (minIdx <= maxIdx) continue;
      var dt = (pts[minIdx].t - pts[maxIdx].t) / 1000;
      if (dt < C.MIN_DUR) continue;
      if (dv / 3.6 / dt < C.A_MIN) continue;
      cands.push({ idx: maxIdx, dv: dv });
    }
  }
  scan(C.WIN_LARGE, C.DV_LARGE);
  scan(C.WIN_SMALL, C.DV_SMALL);
  cands.sort(function (a, b) { return a.idx - b.idx; });
  var merged = [];
  for (i = 0; i < cands.length; i++) {
    if (merged.length === 0 || cands[i].idx - merged[merged.length - 1].idx >= C.MERGE_GAP) merged.push(cands[i]);
    else if (cands[i].dv > merged[merged.length - 1].dv) merged[merged.length - 1] = cands[i];
  }
  var r = Math.round(merged.length * C.CALIB_FACTOR);
  return r < 0 ? 0 : r;
}

// ---- 压弯 countBends（累计转角法）----
function countBends(pts) {
  if (!pts || pts.length < 4) return 0;
  var n = pts.length, i;

  // 1) 逐段航向（无效段标 NaN）
  var hdg = [], segD = [], dt = [];
  for (i = 0; i < n - 1; i++) {
    var d = distM(pts[i].lon, pts[i].lat, pts[i + 1].lon, pts[i + 1].lat);
    var tt = pts[i + 1].t - pts[i].t;
    segD[i] = d; dt[i] = tt;
    if (d < C.BEND_SEG_DIST_MIN || tt > C.BEND_GAP_MS_MAX || tt <= 0) hdg[i] = NaN;
    else hdg[i] = bearing(pts[i].lon, pts[i].lat, pts[i + 1].lon, pts[i + 1].lat);
  }

  // 2) 三点圆均值平滑，压掉 GPS 锯齿
  var sh = [];
  for (i = 0; i < n - 1; i++) {
    if (isNaN(hdg[i])) { sh[i] = NaN; continue; }
    var a = (i > 0 && !isNaN(hdg[i - 1])) ? hdg[i - 1] : null;
    var b = hdg[i];
    var c = (i < n - 2 && !isNaN(hdg[i + 1])) ? hdg[i + 1] : null;
    if (a !== null && c !== null) sh[i] = mid(mid(a, b), c);
    else if (a !== null) sh[i] = mid(a, b);
    else if (c !== null) sh[i] = mid(b, c);
    else sh[i] = b;
  }

  // 3) 逐点标记「是否在转弯中」
  var turn = [], dhdg = [], sgn = [];
  for (i = 1; i < n - 1; i++) {
    turn[i] = false; dhdg[i] = 0; sgn[i] = 0;
    if (isNaN(sh[i - 1]) || isNaN(sh[i])) continue;
    var d = angDiff(sh[i - 1], sh[i]);
    dhdg[i] = d;
    var vIn = Math.max(pts[i - 1].v || 0, pts[i].v || 0);
    if (vIn < C.BEND_V_MIN) continue;
    if (vIn > C.BEND_V_MAX) continue;
    if (Math.abs(d) >= C.BEND_STEP_MAX) continue;
    if (Math.abs(d) >= C.BEND_SEED) { turn[i] = true; sgn[i] = (d > 0) ? 1 : -1; }
  }

  // 4) 合并为「同向转动区间」
  var runs = [], cur = null, gap = 0;
  for (i = 1; i < n - 1; i++) {
    if (turn[i]) {
      if (!cur) cur = { s: i, e: i, cum: 0, sign: sgn[i] };
      if (sgn[i] === cur.sign) { cur.e = i; cur.cum += Math.abs(dhdg[i]); gap = 0; }
      else { runs.push(cur); cur = { s: i, e: i, cum: Math.abs(dhdg[i]), sign: sgn[i] }; gap = 0; }
    } else {
      if (cur && gap < C.BEND_ALLOW_GAP) { gap++; cur.e = i; continue; }
      if (cur) { runs.push(cur); cur = null; }
    }
  }
  if (cur) runs.push(cur);

  // 5) 角度+时长+速度+上限双过滤，再按时间邻近合并同向区间
  var cnt = 0, lastEnd = -9999, lastSign = 0;
  for (i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (r.cum < C.BEND_CUM_MIN) continue;
    if (r.cum > C.BEND_CUM_CAP) continue;
    if (r.e - r.s + 1 < C.BEND_RUN_MIN) continue;
    var maxV = 0;
    for (var j = r.s; j <= r.e; j++) {
      if (pts[j].v > maxV) maxV = pts[j].v;
    }
    if (maxV > C.BEND_V_MAX) continue;
    if (r.sign === lastSign && r.s - lastEnd <= C.BEND_MERGE_GAP) { lastEnd = r.e; continue; }
    cnt++; lastEnd = r.e; lastSign = r.sign;
  }
  return Math.round(cnt * C.BEND_COEF);
}


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
    if(o && o.version===1 && o.scopes && typeof o.scopes==='object' && !Array.isArray(o.scopes)) return o;
  } catch(e) { log('缓存不可读，本次从空缓存开始'); }
  return {version:1,scopes:{}};
}
function save(db) {
  var s=JSON.stringify(db), count=0;
  Object.keys(db.scopes).forEach(function(k) { count+=Object.keys(db.scopes[k]).length; });
  if(count>MAX_RIDES || s.length>MAX_CHARS) { log('缓存已满，本次只补全行程；请手动清空缓存后重建'); return; }
  try { if(!$persistentStore.write(s,KEY)) log('缓存保存失败，本次估算未持久化'); }
  catch(e) { log('缓存保存失败，本次估算未持久化'); }
}
function fill(obj,key,value) {
  if(value>=0 && isFinite(value) && missing(obj[key])) {
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
function sums(rides,date,prefix) {
  var b=0,d=0,n=0;
  Object.keys(rides).forEach(function(k) {
    var r=rides[k];
    if(r && (prefix ? r.day.slice(0,7)===date : r.day===date)) { b+=r.b; d+=r.d; n++; }
  });
  return {b:b,d:d,n:n};
}
function fillDay(rec,date,rides) {
  var ds=day(date); if(!ds) return;
  var s=sums(rides,ds,false); if(!s.n) return;
  if(s.b>0) fill(rec,'brakesTimesDay',s.b);
  if(s.d>0) fill(rec,'bendingTimesDay',s.d);
}
function cachedRide(rec,rides,date) {
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
  if(!c || typeof c.b!=='number' || typeof c.d!=='number' ||
     !isFinite(c.b) || !isFinite(c.d) || c.b<0 || c.d<0) return false;
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
  if(type==='vehicleHomePageV2' || type==='vehicle/list' || type==='myRideInfo' || type==='ridetrack_v2') gate(data,0);
  if(type==='vehicleHomePageV2' || type==='vehicle/list') {
    var gated=JSON.stringify(obj); return gated===original ? {} : {body:gated};
  }
  var q=query(url), scope=identity(req,q,data), db=load();
  var rides=scope && own(db.scopes,scope) ? db.scopes[scope] : {};
  var dirty=false, computed=0, reused=0;
  if(type==='ridetrack_v2' && Array.isArray(data)) {
    data.forEach(function(group) {
      if(!group || !Array.isArray(group.historyList)) return;
      group.historyList.forEach(function(r) {
        if(!r || typeof r!=='object') return;
        // Reuse even zero estimates before parsing or scanning the trajectory.
        if(cachedRide(r,rides,group.dayTime)) { reused++; return; }
        var segments=parseTraj(r.trajectory);
        if(!segments.length) return;
        var b=0,d=0;
        segments.forEach(function(pts) { b+=countBrakes(pts); d+=countBends(pts); });
        fill(r,'brakesTimes',b); fill(r,'bendingTimes',d); computed++;
        var ds=day(r.dayTime || group.dayTime), id=r.rideId || r.id || r.recordId;
        if(!scope || !ds || id===undefined || id===null || id==='') return;
        // Only uncached rides reach estimation and persistence.
        rides[ds+'|'+String(id)]={id:String(id),day:ds,b:isFinite(number(r.brakesTimes)) && number(r.brakesTimes)>=0 ? number(r.brakesTimes) : b,d:isFinite(number(r.bendingTimes)) && number(r.bendingTimes)>=0 ? number(r.bendingTimes) : d};
        dirty=true;
      });
    });
    if(dirty) { db.scopes[scope]=rides; save(db); }
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
  var body=JSON.stringify(obj); return body===original ? {} : {body:body};
}
var result={};
try { result=main(); }
catch(e) { log('响应或缓存格式不支持，原样放行'); }
$done(result);
})();
