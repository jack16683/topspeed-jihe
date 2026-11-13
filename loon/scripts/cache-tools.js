/* SPDX-License-Identifier: AGPL-3.0-only */
(function () {
  var key='zeeho.ridefill.v1', mode=typeof $argument==='string' ? $argument : 'status';
  var title='极速鸡盒', message='';
  try {
    if(mode==='clear') {
      var ok=$persistentStore.write(JSON.stringify({version:1,scopes:{}}),key);
      message=ok ? '已清空估算缓存。重新打开行程即可重建。' : '清空失败，旧缓存仍可能保留。';
    } else {
      var s=$persistentStore.read(key), db=s ? JSON.parse(s) : {scopes:{}}, n=0;
      Object.keys(db.scopes || {}).forEach(function(k) { n+=Object.keys(db.scopes[k]).length; });
      message='缓存车辆/账号组：'+Object.keys(db.scopes || {}).length+'；已缓存行程：'+n+'。\n先打开行程轨迹，再刷新骑行统计。统计仅覆盖已加载行程。';
    }
  } catch(e) { message='缓存读取或写入失败。'; }
  console.log('[极速鸡盒] '+message);
  if(typeof $notification!=='undefined') $notification.post(title,'',message);
  $done({});
})();
