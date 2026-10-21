/* Flavor presentation: desktop reveal and a continuously moving mobile belt. */
(function(root){
 'use strict';
 const DESKTOP_INTERVAL=5000;
 const mod=(value,length)=>length>0?((value%length)+length)%length:0;
 const wrap=(position,base,length)=>base+mod(position-base,length);
 const direction=(from,to,count)=>to===(from+1)%count?1:to===(from-1+count)%count?-1:to>from?1:-1;
 function render(P,c){
  const {esc,t,img,name,stats,note,color,cut,lang}=c;
  const words=lang==='en'?['PLAY YOUR WAY','MILANO GIVEAWAY','NATURAL SUGAR','HALAL CERTIFIED']:['ЗАРЯДИ СВОЙ РЕЖИМ','РОЗЫГРЫШ MILANO','НАТУРАЛЬНЫЙ САХАР','СЕРТИФИКАТ ХАЛЯЛЬ'];
  const ticker=words.map((s,i)=>`<span${i===2?' class="marquee-gold"':''}>${s}</span><i>ϟ</i>`).join('');
  const heading=`<div class="flavors-head"><h2><span class="flavor-title-line"><span>${t('flavorsLead')}</span></span><span class="flavor-title-line"><span>${t('flavorsBrand')}</span></span></h2><p>${P.length} ${t('flavorsCount')}</p></div>`;
  if(!P.length)return `<section class="sec flavors" id="flavors"><div class="w2 flavors-wrap">${heading}</div></section>`;
  const p=P[0],warning=t('flavorWarning');
  const card=(p,i)=>`<article class="flavor-card" data-flavor-card data-i="${i}" style="--flavor-color:${color(p.color)}"><span class="age">18+</span><div class="flavor-card-media"><img src="${esc(img(p))}" alt="${esc(name(p))}" loading="${i<2?'eager':'lazy'}" draggable="false"></div><div class="flavor-card-body"><h3>MILANO ${esc(name(p))}</h3><p class="flavor-card-taste">${esc(c.taste(p))}</p><ul class="flavor-card-stats">${stats(p)}</ul><p class="flavor-card-note">${esc(note(p))||'&nbsp;'}</p><p class="flavor-card-warning">${warning}</p></div></article>`;
  return `<section class="sec flavors" id="flavors" data-active="0" style="--active-color:${color(p.color)}" translate="no"><div class="energy-marquee" aria-hidden="true"><div><div class="marquee-group">${ticker}</div><div class="marquee-group">${ticker}</div></div></div><div class="w2 flavors-wrap">${heading}<div class="flavor-showcase" data-flavor-showcase><div class="flavor-stage"><span class="age">18+</span><div class="flavor-aura"></div><img class="flavor-main-image" src="${esc(img(p))}" alt="${esc(name(p))}" draggable="false"><img class="flavor-reveal-image" alt="" aria-hidden="true" hidden draggable="false"></div><div class="flavor-copy" id="flavor-panel" role="tabpanel" tabindex="0" aria-labelledby="flavor-tab-0"><p class="flavor-brand">MILANO</p><h3 class="flavor-name">${esc(name(p))}</h3><p class="flavor-taste">${esc(c.taste(p))}</p><ul class="flavor-stats">${stats(p)}</ul><p class="flavor-note">${esc(note(p))||'&nbsp;'}</p><p class="flavor-warning">${warning}</p><a class="btn pr flavor-cta" href="#where">${t('whereToBuy')}</a><span class="sr flavor-announcement" role="status" aria-live="polite"></span></div><div class="flavor-tabs" role="tablist" aria-label="${t('flavorCarousel')}">${P.map((p,i)=>`<button type="button" id="flavor-tab-${i}" role="tab" aria-controls="flavor-panel" aria-selected="${i===0}" tabindex="${i===0?'0':'-1'}" data-flavor-tab data-i="${i}" style="--flavor-color:${color(p.color)}"><span class="flavor-tab-thumb"><img src="${esc(cut(p)||img(p))}" alt="" loading="lazy"></span><span>${esc(name(p))}</span></button>`).join('')}</div></div><div class="flavor-mobile"><div class="flavor-viewport" data-flavor-viewport role="region" aria-label="${t('flavorCarousel')}" tabindex="0"><div class="flavor-track" data-flavor-track>${P.map(card).join('')}</div></div></div></div></section>`;
 }
 function mount(section,P,c){
  if(!section||!P.length)return ()=>{};
  const $=s=>section.querySelector(s),$$=s=>[...section.querySelectorAll(s)],mobile=matchMedia('(max-width:760px)'),motion=matchMedia('(prefers-reduced-motion:reduce)');
  const stage=$('.flavor-stage'),main=$('.flavor-main-image'),overlay=$('.flavor-reveal-image'),panel=$('.flavor-copy'),tabs=$$('[data-flavor-tab]'),viewport=$('[data-flavor-viewport]'),track=$('[data-flavor-track]');
  const controller=new AbortController(),on=(el,type,fn,options={})=>el?.addEventListener(type,fn,{...options,signal:controller.signal});
  const original=$$('[data-flavor-card]'),animations=new Set();let generation=0,active=0,disposed=false,busy=false,queued=null,visible=false,hover=false,keyboardFocus=false,holding=false,heldUntil=0,nextAt=performance.now()+DESKTOP_INTERVAL,frame=0,previous=0,offset=0,base=0,cycle=0,stride=0,pointer=null;
  const reduced=()=>motion.matches||!!navigator.connection?.saveData;
  const animate=(el,keyframes,options)=>{if(!el)return Promise.resolve();const animation=el.animate(keyframes,options);animations.add(animation);return animation.finished.catch(()=>{}).finally(()=>animations.delete(animation))};
  const announce=(p,manual)=>{if(manual)$('.flavor-announcement').textContent='MILANO '+c.name(p)};
  const mark=i=>{active=i;section.dataset.active=String(i);tabs.forEach((b,n)=>{b.setAttribute('aria-selected',String(n===i));b.tabIndex=n===i?0:-1});panel.setAttribute('aria-labelledby','flavor-tab-'+i)};
  const apply=(p,i)=>{main.src=c.img(p);main.alt=c.name(p);$('.flavor-name').textContent=c.name(p);$('.flavor-taste').textContent=c.taste(p);$('.flavor-stats').innerHTML=c.stats(p);$('.flavor-note').textContent=c.note(p)||'\u00a0';section.style.setProperty('--active-color',c.color(p.color));mark(i)};
  const preload=p=>{const image=new Image();image.src=c.img(p);return image.decode().catch(()=>{})};
  async function select(i,dir=direction(active,i,P.length),manual=false){
   i=mod(i,P.length);if(disposed||i===active&&!busy)return;
   if(busy){queued={i,dir,manual};return}
   const version=generation;busy=true;await preload(P[i]);if(disposed||version!==generation)return;
   if(queued){const next=queued;queued=null;busy=false;return select(next.i,next.dir,next.manual)}
   const p=P[i];section.dataset.transitioning='true';
   if(reduced()||mobile.matches){apply(p,i)}else{
    overlay.src=c.img(p);overlay.hidden=false;
    section.style.setProperty('--active-color',c.color(p.color));
    const reveal=animate(overlay,[{clipPath:`circle(0% at ${dir>0?'100%':'0%'} 55%)`},{clipPath:`circle(150% at ${dir>0?'100%':'0%'} 55%)`}],{duration:720,easing:'cubic-bezier(.65,0,.2,1)',fill:'both'});
    const text=[$('.flavor-name'),$('.flavor-taste'),$('.flavor-stats'),$('.flavor-note'),$('.flavor-warning'),$('.flavor-cta')];
    await Promise.all(text.map(el=>animate(el,[{opacity:1},{opacity:0}],{duration:120,fill:'forwards'})));if(disposed||version!==generation)return;
    $('.flavor-name').textContent=c.name(p);$('.flavor-taste').textContent=c.taste(p);$('.flavor-stats').innerHTML=c.stats(p);$('.flavor-note').textContent=c.note(p)||'\u00a0';mark(i);
    // Cancel finished fades before the staggered entrance, retaining stable layout.
    text.forEach(el=>el.getAnimations().forEach(a=>a.cancel()));
    await Promise.all([reveal,...text.map((el,n)=>animate(el,[{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'translateY(0)'}],{duration:540,delay:n*45,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'}))]);
    if(disposed||version!==generation)return;main.src=c.img(p);main.alt=c.name(p);overlay.hidden=true;overlay.getAnimations().forEach(a=>a.cancel());text.forEach(el=>el.getAnimations().forEach(a=>a.cancel()));
   }
   busy=false;section.dataset.transitioning='false';announce(p,manual);
   const next=queued;queued=null;if(next&&next.i!==active)select(next.i,next.dir,next.manual);
  }
  // Full duplicate groups keep the last/first boundary visually identical.
  if(P.length>1){const group=()=>original.map(card=>{const clone=card.cloneNode(true);clone.dataset.clone='true';clone.setAttribute('aria-hidden','true');clone.inert=true;clone.querySelectorAll('img').forEach(img=>{img.alt='';img.loading='eager'});return clone});track.prepend(...group());track.append(...group())}
  const paint=()=>{if(!cycle)return;offset=wrap(offset,base,cycle);track.style.transform=`translate3d(${-offset}px,0,0)`;const index=mod(Math.floor((offset-base)/stride+.5),P.length);if(index!==active){section.dataset.active=String(index);active=index;section.style.setProperty('--active-color',c.color(P[index].color))}};
  const measure=()=>{if(!mobile.matches)return;const card=original[0];if(!card?.offsetWidth)return;stride=card.offsetWidth+parseFloat(getComputedStyle(track).gap||'0');cycle=stride*P.length;base=card.offsetLeft-(viewport.clientWidth-card.offsetWidth)/2;offset=base+active*stride;paint()};
  const hold=()=>{heldUntil=performance.now()+5000;nextAt=heldUntil;section.dataset.carouselState='held'};
  const tick=now=>{frame=0;if(disposed||!visible||document.hidden)return;const dt=Math.min(40,previous?now-previous:0);previous=now;
   const paused=reduced()||holding||now<heldUntil||(!mobile.matches&&(hover||keyboardFocus));
   section.dataset.carouselState=reduced()?'reduced':paused?'held':'moving';
   if(!paused&&P.length>1){if(mobile.matches){offset+=dt*.027;paint()}else if(now>=nextAt){nextAt=now+DESKTOP_INTERVAL;select((active+1)%P.length,1)}}
   if(!mobile.matches){const progress=paused?0:Math.max(0,Math.min(1,1-(nextAt-now)/DESKTOP_INTERVAL));tabs[active]?.style.setProperty('--cycle-progress',String(progress))}
   frame=requestAnimationFrame(tick);
  };
  const start=()=>{if(!frame&&visible&&!document.hidden&&!disposed){previous=0;frame=requestAnimationFrame(tick)}};
  const visibility=()=>{cancelAnimationFrame(frame);frame=0;previous=0;if(!document.hidden){nextAt=performance.now()+DESKTOP_INTERVAL;start()}};
  tabs.forEach((button,i)=>{on(button,'click',()=>{hold();select(i,direction(active,i,P.length),true)});on(button,'keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?P.length-1:mod(active+(e.key==='ArrowRight'?1:-1),P.length);hold();select(i,e.key==='ArrowLeft'?-1:1,true);tabs[i].focus()})});
  const tablist=$('.flavor-tabs');on(tablist,'pointerenter',e=>{if(e.pointerType==='mouse'&&!mobile.matches)hover=true});on(tablist,'pointerleave',()=>{hover=false;nextAt=Math.max(performance.now()+DESKTOP_INTERVAL,heldUntil)});
  on(section,'focusin',e=>{keyboardFocus=e.target.matches(':focus-visible')});on(section,'focusout',e=>{if(!section.contains(e.relatedTarget)){keyboardFocus=false;nextAt=Math.max(performance.now()+DESKTOP_INTERVAL,heldUntil)}});
  on(section,'pointerdown',e=>{holding=true;hold();if(mobile.matches&&viewport.contains(e.target))pointer={id:e.pointerId,x:e.clientX,y:e.clientY,start:offset,horizontal:false}});
  on(viewport,'pointermove',e=>{if(!pointer||e.pointerId!==pointer.id)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(!pointer.horizontal&&Math.abs(dx)>7&&Math.abs(dx)>Math.abs(dy)*1.2){pointer.horizontal=true;viewport.setPointerCapture(e.pointerId)}if(pointer.horizontal){if(e.cancelable)e.preventDefault();offset=pointer.start-dx;paint()}},{passive:false});
  const release=()=>{holding=false;pointer=null;hold()};on(document,'pointerup',()=>{if(holding)release()});on(document,'pointercancel',()=>{if(holding)release()});
  on(viewport,'keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();hold();offset+=(e.key==='ArrowRight'?1:-1)*stride;paint()});
  let swipe=null;on(stage,'pointerdown',e=>swipe={x:e.clientX,y:e.clientY});on(stage,'pointerup',e=>{if(!swipe)return;const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y;swipe=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3){hold();const dir=dx<0?1:-1;select(mod(active+dir,P.length),dir,true)}});
  on(document,'visibilitychange',visibility);on(mobile,'change',()=>{generation++;hover=false;animations.forEach(a=>a.cancel());panel.querySelectorAll('*').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));busy=false;queued=null;section.dataset.transitioning='false';apply(P[active],active);overlay.hidden=true;measure();nextAt=performance.now()+DESKTOP_INTERVAL});on(motion,'change',()=>{nextAt=performance.now()+DESKTOP_INTERVAL});on(navigator.connection,'change',()=>{nextAt=performance.now()+DESKTOP_INTERVAL});
  const resize=new ResizeObserver(measure);resize.observe(viewport);measure();
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible){section.classList.add('flavors-ready');nextAt=performance.now()+DESKTOP_INTERVAL;start();if(!mobile.matches&&!reduced())preload(P[(active+1)%P.length])}else{cancelAnimationFrame(frame);frame=0;previous=0}},{threshold:.08});observer.observe(section);
  // Page progress is scroll-driven, and removed with this home instance.
  const header=document.querySelector('header'),progress=document.createElement('div');progress.className='flavor-page-progress';progress.setAttribute('aria-hidden','true');header.append(progress);let progressFrame=0;
  const updateProgress=()=>{progressFrame=0;progress.hidden=motion.matches;const total=document.documentElement.scrollHeight-innerHeight;progress.style.transform=`scaleX(${total>0?scrollY/total:0})`};on(window,'scroll',()=>{if(!progressFrame)progressFrame=requestAnimationFrame(updateProgress)},{passive:true});updateProgress();
  return ()=>{disposed=true;controller.abort();cancelAnimationFrame(frame);cancelAnimationFrame(progressFrame);animations.forEach(a=>a.cancel());observer.disconnect();resize.disconnect();progress.remove();queued=null};
 }
 const api={render,mount,mod,wrap,direction};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MilanoFlavors=api;
})(typeof window!=='undefined'?window:globalThis);
