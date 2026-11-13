/* SPDX-License-Identifier: AGPL-3.0-only */
(function(){
 var key='zeeho.ridefill.v1',mode=typeof $argument==='string'?$argument:'status',algorithm='2.1.0',message='';
 try{
  var existing=null,prior=null;
  try{existing=$persistentStore.read(key);prior=existing?JSON.parse(existing):null;}catch(readError){if(mode!=='clear')throw readError;}
  var last=prior&&prior.lastProfile||'strict-daily';
  if(mode==='clear'){
   message=$persistentStore.write(JSON.stringify({version:2,algorithm:algorithm,lastProfile:last,scopes:{}}),key)?'已清空估算缓存。重新打开行程即可重建。':'清空失败，旧缓存仍可能保留。';
  }else{
   var raw=existing,db=prior||{version:2,algorithm:algorithm,lastProfile:last,scopes:{}},n=0,bUnknown=0,dUnknown=0,sparse=0;
   if(db.version!==2||db.algorithm!==algorithm)message='算法 '+algorithm+'；旧算法缓存已过期。打开行程后自动重算一次。';
   else{
    var keys=Object.keys(db.scopes||{}).filter(function(k){return k.indexOf(last+'|')===0;});
    keys.forEach(function(k){Object.keys(db.scopes[k]).forEach(function(id){var r=db.scopes[k][id];n++;if(r.q&&r.q.brake==='sparse')sparse++;if(r.b===null)bUnknown++;if(r.d===null)dUnknown++;});});
    message='算法 '+algorithm+'；急刹：'+(last.indexOf('cloud-like')===0?'云端近似（非G检测）':'严格G')+'；压弯：'+(last.indexOf('conservative')>=0?'保守估算':'日常估算')+'。\n缓存车辆/账号组：'+keys.length+'；已缓存行程：'+n+'。\n急刹采样不足：'+sparse+' 条；最终急刹未知：'+bUnknown+' 条；转弯几何不足：'+dUnknown+' 条。\n采样不足保留云端值；压弯为模型估算。加载行程后请重新进入统计页。';
   }
  }
 }catch(e){message='缓存读取或写入失败。';}
 console.log('[极速鸡盒] '+message);
 if(typeof $notification!=='undefined')$notification.post('极速鸡盒','',message);
 $done({});
})();
