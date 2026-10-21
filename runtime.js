/* Shared request lifecycle. No automatic retries of writes. */
(function(root){
 'use strict';
 function createClient({fetchImpl,timeoutMs=15000,setTimer=setTimeout,clearTimer=clearTimeout}){
  const pending=new Map();
  function request(path,options={}){
   const method=(options.method||'GET').toUpperCase(),key=method==='GET'&&!options.signal?path:null;
   if(key&&pending.has(key))return pending.get(key);
   const promise=(async()=>{
    const controller=new AbortController();let timer,abort;
    const limit=options.timeoutMs??timeoutMs;
    const timeout=new Promise((_,reject)=>{timer=setTimer(()=>{controller.abort();reject(new Error('request_timeout'))},limit)});
    const {timeoutMs:unused,...init}=options;
    if(options.signal){abort=()=>controller.abort();if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true})}
    try{
     return await Promise.race([timeout,(async()=>{
      const response=await fetchImpl(path,{credentials:'same-origin',...init,signal:controller.signal});
      let result;try{result=await response.json()}catch{throw new Error('invalid_response')}
      if(!response.ok)throw new Error(result.error?.code||'service_unavailable');
      return result;
     })()]);
    }catch(error){
     if(error.name==='AbortError')throw new Error(options.signal?.aborted?'request_cancelled':'request_timeout');
     if(error instanceof TypeError)throw new Error('network_error');
     throw error;
    }finally{clearTimer(timer);if(abort)options.signal.removeEventListener('abort',abort)}
   })();
   if(key){pending.set(key,promise);promise.then(()=>pending.delete(key),()=>pending.delete(key))}
   return promise;
  }
  return {request};
 }
 const sections=new Set(['top','flavors','promo','where','blog','about','quality','A']);
 function isSectionHash(hash){return sections.has(hash.replace(/^#/,''))}
 const exports={createClient,isSectionHash};
 if(typeof module!=='undefined'&&module.exports)module.exports=exports;
 else root.MilanoRuntime=exports;
})(typeof window!=='undefined'?window:globalThis);
