/* CMS-backed editorial grid and a continuous, touch-paused mobile story belt. */
(function(root){
 'use strict';
 const modulo=(v,n)=>((v%n)+n)%n;
 function render(posts,c){
  if(!posts.length)return `<p class="stories-empty">${c.lang==='en'?'New stories are coming soon.':'Скоро здесь появятся новые истории.'}</p>`;
  const {esc}=c;
  return `<div class="stories-viewport" tabindex="0" role="region" aria-label="MILANO / STORIES"><div class="stories-track" data-count="${Math.min(posts.length,3)}">${posts.map((p,i)=>{
   const cover=c.image(p),title=c.text(p,'title');
   return `<article class="story-card" data-i="${i}"><a class="story-open" href="#/post/${encodeURIComponent(p.id)}" aria-label="${esc((c.lang==='en'?'Read: ':'Читать: ')+title)}">${cover?`<img class="story-cover" src="${esc(cover)}" alt="" loading="lazy" decoding="async" draggable="false">`:'<div class="story-cover story-cover-empty" aria-hidden="true">ϟ</div>'}<div class="story-body"><small class="story-tag">${esc(c.text(p,'tag'))}</small><h3 title="${esc(title)}">${esc(title)}</h3><p class="story-excerpt">${esc(c.text(p,'excerpt'))}</p><span class="story-read">${c.lang==='en'?'Read story':'Читать'}<span aria-hidden="true">↗</span></span></div></a></article>`;
  }).join('')}</div></div>`;
 }
 function mount(section){
  const viewport=section?.querySelector('.stories-viewport'),track=section?.querySelector('.stories-track');if(!viewport||!track)return ()=>{};
  const cards=[...track.children],n=cards.length,mobile=matchMedia('(max-width:760px)'),motion=matchMedia('(prefers-reduced-motion:reduce)'),controller=new AbortController();
  const on=(el,type,fn,options={})=>el?.addEventListener(type,fn,{...options,signal:controller.signal});
  let frame=0,previous=0,visible=false,disposed=false,holding=false,heldUntil=0,offset=0,base=0,cycle=0,stride=0,pointer=null,snap=null,suppressUntil=0;
  const reduced=()=>motion.matches||!!navigator.connection?.saveData;
  if(n>1){const group=()=>cards.map(card=>{const clone=card.cloneNode(true);clone.dataset.clone='true';clone.setAttribute('aria-hidden','true');clone.querySelectorAll('a').forEach(a=>a.tabIndex=-1);return clone});track.prepend(...group());track.append(...group())}
  const paint=()=>{if(!cycle||!mobile.matches)return;offset=base+modulo(offset-base,cycle);track.style.transform=`translate3d(${-offset}px,0,0)`};
  const measure=()=>{snap=null;if(!mobile.matches){track.style.removeProperty('transform');return}const index=cycle?modulo(Math.round((offset-base)/stride),n):0;stride=cards[0].offsetWidth+parseFloat(getComputedStyle(track).gap||0);cycle=stride*n;base=cards[0].offsetLeft-(viewport.clientWidth-cards[0].offsetWidth)/2;offset=base+index*stride;paint()};
  const freeze=(center=true)=>{heldUntil=performance.now()+7000;section.dataset.storiesState='held';if(center&&stride)snap={from:offset,to:base+Math.round((offset-base)/stride)*stride,at:performance.now()}};
  const tick=now=>{frame=0;if(disposed||!visible||document.hidden||!mobile.matches)return;const dt=Math.min(40,previous?now-previous:0);previous=now;
   if(snap){const progress=reduced()?1:Math.min(1,(now-snap.at)/280);offset=snap.from+(snap.to-snap.from)*(1-Math.pow(1-progress,3));if(progress===1)snap=null;paint()}
   const paused=holding||now<heldUntil||reduced()||n<2;
   section.dataset.storiesState=paused?'held':'moving';if(!paused&&!snap){offset+=dt*.024;paint()}
   frame=requestAnimationFrame(tick);
  };
  const start=()=>{if(!frame&&visible&&!document.hidden&&mobile.matches&&!disposed){previous=0;frame=requestAnimationFrame(tick)}};
  on(section,'pointerdown',e=>{if(mobile.matches&&!viewport.contains(e.target))freeze()});
  on(viewport,'pointerdown',e=>{if(!mobile.matches||e.button>0)return;suppressUntil=0;holding=true;snap=null;freeze(false);pointer={id:e.pointerId,x:e.clientX,y:e.clientY,start:offset,horizontal:false,moved:false}});
  on(viewport,'pointermove',e=>{if(!pointer||pointer.id!==e.pointerId)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(dx,dy)>8)pointer.moved=true;if(!pointer.horizontal&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)*1.2){pointer.horizontal=true;viewport.setPointerCapture(e.pointerId)}if(pointer.horizontal){if(e.cancelable)e.preventDefault();offset=pointer.start-dx;paint()}},{passive:false});
  const release=()=>{if(!pointer)return;if(pointer.moved)suppressUntil=performance.now()+600;holding=false;pointer=null;freeze()};on(document,'pointerup',release);on(document,'pointercancel',release);
  on(viewport,'click',e=>{if(mobile.matches&&performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation()}},{capture:true});
  on(viewport,'dragstart',e=>{if(mobile.matches)e.preventDefault()});
  on(viewport,'keydown',e=>{if(!mobile.matches||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const index=modulo(Math.round((offset-base)/stride),n);offset=base+(e.key==='Home'?0:e.key==='End'?n-1:modulo(index+(e.key==='ArrowRight'?1:-1),n))*stride;paint();freeze()});
  on(viewport,'focusin',e=>{if(!mobile.matches||!e.target.matches(':focus-visible'))return;const card=e.target.closest('.story-card');if(card){offset=base+Number(card.dataset.i)*stride;paint()}freeze()});
  on(viewport,'wheel',()=>{if(mobile.matches)freeze()},{passive:true});
  on(mobile,'change',()=>{holding=false;pointer=null;cancelAnimationFrame(frame);frame=0;measure();start()});
  on(document,'visibilitychange',()=>{cancelAnimationFrame(frame);frame=0;previous=0;start()});
  const resize=new ResizeObserver(measure);resize.observe(viewport);measure();
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)start();else{cancelAnimationFrame(frame);frame=0;previous=0}},{threshold:.05});observer.observe(section);
  return()=>{disposed=true;controller.abort();cancelAnimationFrame(frame);resize.disconnect();observer.disconnect()};
 }
 root.MilanoStories={render,mount};
})(window);
