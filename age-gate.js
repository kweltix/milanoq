/* A self-declared age gate, not identity verification or server authorization. */
(() => {
 'use strict';
 const root=document.documentElement,gate=document.getElementById('age-gate');
 const key='milano.age.v1',deniedKey='milano.age.denied.v1',ttl=90*86400000;
 const callbacks=[],originalInert=new Map();
 let allowed=false,booted=false;
 const read=(store,k)=>{try{return window[store].getItem(k)}catch{return null}};
 const write=(store,k,v)=>{try{window[store].setItem(k,v)}catch{}};
 const remove=(store,k)=>{try{window[store].removeItem(k)}catch{}};
 const valid=()=>{try{const value=JSON.parse(read('localStorage',key)),now=Date.now();return value?.version===1&&Number.isFinite(value.confirmedAt)&&value.confirmedAt<=now&&value.expiresAt===value.confirmedAt+ttl&&value.expiresAt>now}catch{return false}};
 const words={ru:{question:'Вам исполнилось 18 лет?',intro:'Сайт MILANO предназначен для посетителей старше 18 лет.',yes:'Да, мне 18+',no:'Нет',note:'Запомним подтверждение на 90 дней в этом браузере.',denied:'Доступ только для посетителей 18+',message:'Вы указали, что вам ещё нет 18 лет. Содержимое сайта недоступно.',correct:'Ответил ошибочно',language:'EN',languageLabel:'Switch to English'},en:{question:'Are you 18 or older?',intro:'The MILANO website is intended for visitors aged 18 and over.',yes:'Yes, I am 18+',no:'No',note:'We will remember your confirmation for 90 days in this browser.',denied:'For visitors aged 18+ only',message:'You indicated that you are under 18. The website content is unavailable.',correct:'I answered by mistake',language:'RU',languageLabel:'Переключить на русский'}};
 function translate(){
  const copy=words[root.lang==='en'?'en':'ru'];
  for(const [id,text]of Object.entries({'age-question-title':copy.question,'age-intro':copy.intro,'age-yes':copy.yes,'age-no':copy.no,'age-note':copy.note,'age-denied-title':copy.denied,'age-denied-message':copy.message,'age-correct':copy.correct,'age-language':copy.language}))document.getElementById(id).textContent=text;
  document.getElementById('age-language').setAttribute('aria-label',copy.languageLabel);
 }
 function lock(state){
  allowed=false;root.dataset.ageState=state;gate.hidden=false;
  for(const el of document.body.children){if(el===gate||['SCRIPT','STYLE','LINK'].includes(el.tagName))continue;if(!originalInert.has(el))originalInert.set(el,el.inert);el.inert=true}
  document.getElementById('age-pending').hidden=true;
  document.getElementById('age-question').hidden=state!=='question';document.getElementById('age-denied').hidden=state!=='denied';
  gate.setAttribute('aria-labelledby',state==='denied'?'age-denied-title':'age-question-title');gate.setAttribute('aria-describedby',state==='denied'?'age-denied-message':'age-intro');translate();
  document.getElementById(state==='denied'?'age-correct':'age-yes').focus({preventScroll:true});
  dispatchEvent(new CustomEvent('milano:agechange',{detail:{allowed:false}}));
 }
 function grant(){
  allowed=true;root.dataset.ageState='granted';gate.hidden=true;
  originalInert.forEach((value,el)=>{el.inert=value});originalInert.clear();
  dispatchEvent(new CustomEvent('milano:agechange',{detail:{allowed:true}}));
  if(!booted){booted=true;callbacks.splice(0).forEach(fn=>fn())}
  // The dialog is gone: do not leave keyboard focus on its hidden button.
  if(gate.contains(document.activeElement))document.getElementById('A').focus({preventScroll:true});
 }
 const check=()=>{if(read('sessionStorage',deniedKey)==='1')lock('denied');else if(valid())grant();else{remove('localStorage',key);lock('question')}};
 window.MilanoAgeGate=Object.freeze({get allowed(){return allowed},whenAllowed(fn){if(allowed)fn();else callbacks.push(fn)}});
 document.getElementById('age-yes').onclick=()=>{const now=Date.now();remove('sessionStorage',deniedKey);write('localStorage',key,JSON.stringify({version:1,confirmedAt:now,expiresAt:now+ttl}));grant()};
 document.getElementById('age-no').onclick=()=>{remove('localStorage',key);write('sessionStorage',deniedKey,'1');lock('denied')};
 document.getElementById('age-correct').onclick=()=>{remove('sessionStorage',deniedKey);lock('question')};
 document.getElementById('age-language').onclick=()=>{root.lang=root.lang==='en'?'ru':'en';write('localStorage','ml',root.lang);translate()};
 gate.addEventListener('keydown',event=>{
  if(allowed)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation()}
  if(event.key!=='Tab')return;const buttons=[...gate.querySelectorAll('button')].filter(el=>el.getClientRects().length&&!el.disabled),first=buttons[0],last=buttons[buttons.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 });
 document.addEventListener('focusin',event=>{if(!allowed&&!gate.contains(event.target))document.getElementById(root.dataset.ageState==='denied'?'age-correct':'age-yes').focus({preventScroll:true})});
 addEventListener('pageshow',event=>{if(event.persisted)check()});
 check();
})();
