/* Native loop of the pre-rendered forward/reverse sequence: no player swap. */
window.MilanoHero={mount(hx,{restricted}){
 const poster=hx.querySelector('.hx-poster'),slot=hx.querySelector('.hx-in');
 const mobile=matchMedia('(max-width:760px), (max-width:1100px) and (orientation:portrait)'),motion=matchMedia('(prefers-reduced-motion:reduce)');
 let video=null,blocked=false,visible=true,disposed=false,generation=0;
 const atmosphere=window.MilanoAtmosphere?.mount(hx,{mobile,restricted});
 const pause=()=>{video?.pause();atmosphere?.setRunning(false)};
 const play=()=>{const current=video,version=generation;if(!current||disposed||!visible||document.hidden||(window.MilanoAgeGate&&!MilanoAgeGate.allowed))return;current.play().catch(()=>{if(version===generation&&!disposed&&visible&&!document.hidden)blocked=true})};
 const clear=()=>{++generation;atmosphere?.setRunning(false);if(video){video.pause();video.removeAttribute('src');video.load();video.remove();video=null}};
 const setup=()=>{
  clear();blocked=false;poster.src=mobile.matches?'assets/hero-m.webp':'assets/hero-pc.webp';
  hx.style.setProperty('--hero-poster',`url("${poster.src}")`);
  atmosphere?.refresh();if(restricted()||(window.MilanoAgeGate&&!MilanoAgeGate.allowed))return;
  const current=document.createElement('video');video=current;current.className='hx-v';current.muted=current.defaultMuted=true;current.playsInline=true;current.loop=true;current.preload='metadata';current.setAttribute('aria-hidden','true');current.tabIndex=-1;
  current.addEventListener('playing',()=>{if(video===current){blocked=false;current.classList.add('on');atmosphere?.setRunning(true)}});
  current.addEventListener('pause',()=>{if(video===current)atmosphere?.setRunning(false)});
  current.addEventListener('error',()=>{if(video!==current)return;current.classList.remove('on');atmosphere?.setRunning(false)});
  current.src=mobile.matches?'assets/hero-mobile-seamless.mp4':'assets/hero-desktop-4k.mp4';slot.append(current);play();
 };
 // Если браузер запретил автозапуск, повторяем его после обычного действия пользователя.
 const retry=()=>{if(blocked)play()};document.addEventListener('pointerdown',retry,{passive:true});
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;visible?play():pause()});observer.observe(hx);
 const visibility=()=>document.hidden?pause():play();
 document.addEventListener('visibilitychange',visibility);mobile.addEventListener('change',setup);motion.addEventListener('change',setup);navigator.connection?.addEventListener('change',setup);setup();
 const ageChange=()=>{if(!disposed)setup()};addEventListener('milano:agechange',ageChange);
 return ()=>{disposed=true;clear();atmosphere?.cleanup();observer.disconnect();document.removeEventListener('pointerdown',retry);document.removeEventListener('visibilitychange',visibility);mobile.removeEventListener('change',setup);motion.removeEventListener('change',setup);navigator.connection?.removeEventListener('change',setup);removeEventListener('milano:agechange',ageChange)};
}};
