/* Lightweight adaptation of the supplied particle-text idea: no React, black
   canvas background, random copy, right-click hijacking or perpetual text loop. */
(() => {
 let introDone=false;
 window.MilanoAtmosphere={mount(hx,{mobile,restricted}){
  let rain=null,canvas=null,frame=0,running=false,disposed=false,introPending=false;
  const root=document.documentElement;
  const allowed=()=>!disposed&&!mobile.matches&&!restricted()&&root.dataset.milanoMotion!=='off'&&!root.hasAttribute('data-motion-disabled')&&(!window.MilanoAgeGate||MilanoAgeGate.allowed);
  const clearIntro=()=>{cancelAnimationFrame(frame);frame=0;canvas?.remove();canvas=null;introPending=false};
  const intro=async()=>{
   if(introDone||introPending||canvas||!allowed()||!running)return;introPending=true;
   await document.fonts?.ready;
   if(!allowed()||!running||!hx.isConnected){introPending=false;return}
   const label=hx.querySelector('.hx-eb'),style=getComputedStyle(label),w=Math.min(720,label.clientWidth),h=Math.max(22,label.clientHeight);
   if(!w){introPending=false;return}
   const sample=document.createElement('canvas');sample.width=w;sample.height=h;const s=sample.getContext('2d');if(!s){introPending=false;return}
   s.font=style.font;s.textBaseline='middle';if('letterSpacing' in s)s.letterSpacing=style.letterSpacing;s.fillStyle='#fff';s.fillText(label.textContent,0,h/2,w);
   const pixels=s.getImageData(0,0,w,h).data,particles=[];
   for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2)if(pixels[(y*w+x)*4+3]>80&&particles.length<500)particles.push({x,y,sx:Math.random()*w,sy:Math.random()*h*5-h*2,delay:Math.random()*.15});
   canvas=document.createElement('canvas');canvas.className='hero-particles';canvas.setAttribute('aria-hidden','true');const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';label.append(canvas);
   const ctx=canvas.getContext('2d');if(!ctx){clearIntro();return}ctx.scale(dpr,dpr);ctx.fillStyle=style.color;
   const start=performance.now();
   const draw=now=>{
    if(!allowed()||!running||!canvas){clearIntro();return}
    const p=Math.min(1,(now-start)/1700);ctx.clearRect(0,0,w,h);ctx.globalAlpha=.8*Math.min(1,(1-p)*5);
    for(const dot of particles){const q=Math.max(0,Math.min(1,(p-dot.delay)/.7)),e=1-Math.pow(1-q,3);ctx.fillRect(dot.sx+(dot.x-dot.sx)*e,dot.sy+(dot.y-dot.sy)*e,1.2,1.2)}
    if(p<1)frame=requestAnimationFrame(draw);else{introDone=true;clearIntro()}
   };frame=requestAnimationFrame(draw);
  };
  const measure=()=>rain?.style.setProperty('--rain-distance',(hx.clientHeight+100)+'px');
  const refresh=()=>{
   if(!allowed()){rain?.remove();rain=null;clearIntro();return}
   if(!rain){rain=document.createElement('div');rain.className='hero-rain';rain.setAttribute('aria-hidden','true');for(let i=0;i<32;i++){const drop=document.createElement('i');drop.style.cssText=`--x:${Math.random()*110}%;--length:${14+Math.random()*18}px;--speed:${.7+Math.random()*.8}s;--delay:${-Math.random()*2}s`;rain.append(drop)}hx.querySelector('.hero-scene').append(rain);measure()}
   rain.dataset.running=String(running&&!document.hidden);if(running)intro();
  };
  const resize=new ResizeObserver(()=>{measure();if(canvas)clearIntro()});resize.observe(hx);
  const flags=new MutationObserver(refresh);flags.observe(root,{attributes:true,attributeFilter:['data-milano-motion','data-motion-disabled']});
  refresh();
  return {refresh,setRunning(value){running=Boolean(value);refresh()},cleanup(){disposed=true;resize.disconnect();flags.disconnect();rain?.remove();rain=null;clearIntro()}};
 }};
})();
