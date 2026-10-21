/* Decorative golden pointer trail. No cursor replacement, UI controls or dependencies. */
(() => {
 'use strict';
 const desktop=matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let canvas=null,ctx=null,frame=0,last=0,lastEmit=-Infinity,particles=[];
 const allowed=()=>desktop.matches&&!reduced.matches&&!navigator.connection?.saveData&&!document.hidden&&!location.hash.startsWith('#/admin')&&(!window.MilanoAgeGate||window.MilanoAgeGate.allowed);
 const clear=()=>{cancelAnimationFrame(frame);frame=0;last=0;lastEmit=-Infinity;particles=[];canvas?.remove();canvas=null;ctx=null};
 const resize=()=>{if(!canvas)return;const ratio=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);ctx.setTransform(ratio,0,0,ratio,0,0)};
 const draw=now=>{
  frame=0;if(!allowed()){clear();return}
  const delta=Math.min(2.5,Math.max(.1,(now-(last||now-16.67))/16.67));last=now;
  ctx.clearRect(0,0,innerWidth,innerHeight);ctx.fillStyle='#f5c842';
  particles=particles.filter(p=>{p.life-=.028*delta;if(p.life<=0)return false;p.x+=p.vx*delta;p.y+=p.vy*delta;p.vy+=.075*delta;ctx.globalAlpha=p.life*.75;ctx.beginPath();ctx.arc(p.x,p.y,2.4*p.life+.5,0,Math.PI*2);ctx.fill();return true});
  ctx.globalAlpha=1;
  if(particles.length)frame=requestAnimationFrame(draw);else last=0;
 };
 window.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse'||!allowed())return;
  const now=performance.now();if(now-lastEmit<16)return;lastEmit=now;
  if(!canvas){canvas=document.createElement('canvas');canvas.dataset.cursorTrail='';canvas.setAttribute('aria-hidden','true');canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';ctx=canvas.getContext('2d');if(!ctx){clear();return}document.body.append(canvas);resize()}
  for(let i=0;i<3;i++)particles.push({x:e.clientX,y:e.clientY,vx:(Math.random()-.5)*2.6,vy:(Math.random()-.5)*2.6,life:1});
  if(particles.length>144)particles.splice(0,particles.length-144);
  if(!frame)frame=requestAnimationFrame(draw);
 },{passive:true});
 desktop.addEventListener('change',clear);reduced.addEventListener('change',clear);
 navigator.connection?.addEventListener('change',clear);
 window.addEventListener('resize',resize,{passive:true});
 window.addEventListener('blur',clear);window.addEventListener('pagehide',clear);
 window.addEventListener('hashchange',()=>{if(!allowed())clear()});
 window.addEventListener('milano:agechange',()=>{if(!allowed())clear()});
 document.addEventListener('visibilitychange',clear);document.documentElement.addEventListener('pointerleave',clear);
})();
