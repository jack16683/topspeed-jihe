/* SPDX-License-Identifier: AGPL-3.0-only */
(function(){
 var key='zeeho.ridefill.v1',mode=typeof $argument==='string'?$argument:'status',algorithm='2.0.0',message='';
 try{
  if(mode==='clear'){
   message=$persistentStore.write(JSON.stringify({version:2,algorithm:algorithm,scopes:{}}),key)?'已清空估算缓存。重新打开行程即可重建。':'清空失败，旧缓存仍可能保留。';
  }else{
   var raw=$persistentStore.read(key),db=raw?JSON.parse(raw):{version:2,algorithm:algorithm,scopes:{}},n=0,bUnknown=0,dUnknown=0;
   if(db.version!==2||db.algorithm!==algorithm)message='算法 '+algorithm+'；旧算法缓存已过期。打开行程后自动重算一次。';
   else{
    Object.keys(db.scopes||{}).forEach(function(k){Object.keys(db.scopes[k]).forEach(function(id){var r=db.scopes[k][id];n++;if(r.b===null)bUnknown++;if(r.d===null)dUnknown++;});});
    message='算法 '+algorithm+'；缓存车辆/账号组：'+Object.keys(db.scopes||{}).length+'；已缓存行程：'+n+'。\n急刹采样不足：'+bUnknown+' 条；转弯几何不足：'+dUnknown+' 条。\n采样不足保留云端值；压弯为模型估算。加载行程后请重新进入统计页。';
   }
  }
 }catch(e){message='缓存读取或写入失败。';}
 console.log('[极速鸡盒] '+message);
 if(typeof $notification!=='undefined')$notification.post('极速鸡盒','',message);
 $done({});
})();
