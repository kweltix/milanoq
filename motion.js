/* Optional public-site motion layer. No navigation interception or data requests. */
(() => {
 'use strict';
 const root=document.documentElement;
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 const mobile=matchMedia('(max-width: 760px)');
 const seen=new Set();
 const mounts=new Set();
 let enabled=true;
 try{enabled=localStorage.getItem('milano.motion')!=='off'}catch{}
 const allowed=()=>enabled&&!root.hasAttribute('data-motion-disabled')&&!media.matches&&!navigator.connection?.saveData;
 const sync=()=>{root.dataset.milanoMotion=allowed()?'on':'off';if(!allowed())mounts.forEach(m=>m.finish())};
 function mount(container,{view='home'}={}){
  container.dataset.mmView=view;
  const targets=new Map(),photos=new Set();
  const controller=new AbortController();
  let observer=null;
  const finishElement=(el,remember=true)=>{if(!targets.has(el))return;if(remember)seen.add(targets.get(el));el.dataset.mm='done';el.classList.add('in');observer?.unobserve(el)};
  const finish=(remember=true)=>{targets.forEach((_,el)=>finishElement(el,remember));photos.forEach(el=>el.remove());photos.clear()};
  const state={finish};mounts.add(state);
  const photo=el=>{
   el=el.closest('#promo');if(!el||!allowed()||seen.has('home:photo:promo'))return;
   seen.add('home:photo:promo');
   const c=getComputedStyle(el);if(c.backgroundImage==='none')return;
   const layer=document.createElement('div');layer.className='milano-motion-photo';layer.setAttribute('aria-hidden','true');
   for(const key of ['backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat'])layer.style[key]=c[key];
   photos.add(layer);layer.addEventListener('animationend',()=>{photos.delete(layer);layer.remove()},{once:true});el.prepend(layer);
  };
  const reveal=el=>{if(el.dataset.mm!=='pending')return;seen.add(targets.get(el));el.dataset.mm='shown';observer?.unobserve(el);photo(el)};
  if(allowed()&&'IntersectionObserver' in window){observer=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting)reveal(e.target)})},{threshold:.06});}
  const add=(selector,group=false)=>{
   container.querySelectorAll(selector).forEach((el,i)=>{
    // Hidden responsive variants and carousel clones must retain their own transforms.
    if(!el.getClientRects().length||targets.has(el))return;
    const key=view+':'+selector+':'+i;targets.set(el,key);el.classList.add('in');
    el.style.setProperty('--mm-delay',group?(i%12)*80+'ms':'0ms');
    if(!observer||seen.has(key)){finishElement(el);return}
    el.dataset.mm='pending';observer.observe(el);
   });
  };
  if(view==='home'){
   // Reveal a moving rail as a whole, never its translated/sliding children.
   add('.hx-eb, .hx h1, .hx-sub, .hx-row',true);
   add('.hx-steps > li',true);
   add('.rv:not(.ab2-s):not(.ab2-c), .flavors-head, .flavor-showcase, .flavor-mobile, .stories-heading');
   add('.ab2-s > div',true);add('.ab2-c > div',true);add('.pz-s > li',true);
   if(mobile.matches)add('.stories-viewport');else add('.story-card',true);
  }else{
   // Entry-only transitions: no delayed links, history changes or fade-out blockers.
   const page=container.firstElementChild;
   if(page){page.dataset.mmPage='';if(view==='blog'){add('[data-mm-page] .sh, [data-mm-page] .bk');add('[data-mm-page] .bl > .bc',true)}else add('[data-mm-page]')}
  }
  container.querySelectorAll('.rv').forEach(el=>el.classList.add('in'));
  container.addEventListener('focusin',e=>{targets.forEach((_,el)=>{if(el.contains(e.target))finishElement(el)})},{signal:controller.signal});
  // Switching width during an entrance must never leave the other layout hidden.
  mobile.addEventListener('change',()=>finish(),{signal:controller.signal});
  return ()=>{observer?.disconnect();controller.abort();finish(false);mounts.delete(state);if(container.dataset.mmView===view)delete container.dataset.mmView;};
 }
 window.MilanoMotion=Object.freeze({mount,setEnabled(value){enabled=Boolean(value);try{localStorage.setItem('milano.motion',enabled?'on':'off')}catch{}sync()},get enabled(){return enabled}});
 media.addEventListener('change',sync);navigator.connection?.addEventListener('change',sync);sync();
})();
