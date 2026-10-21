/* Общая страница отсутствующего адреса: без API, зависимостей и HTML из URL. */
(() => {
 'use strict';
 const copy={
  ru:{title:'Страница не найдена',body:'Возможно, ссылка устарела или страница была перемещена. Вернитесь на главную — там всё самое интересное.',home:'На главную',language:'Switch to English'},
  en:{title:'Page not found',body:'The link may be outdated or the page may have moved. Head back to the homepage to discover MILANO.',home:'Go to homepage',language:'Переключить на русский'}
 };
 const node=(tag,className,text)=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element};
 function render(container,{lang='ru',homeHref='/#top'}={}){
  const locale=lang==='en'?'en':'ru',text=copy[locale],standalone=container.hasAttribute('data-not-found-standalone');
  const section=node('section','not-found');section.dataset.notFound='';
  const shell=node('div','not-found-shell'),brand=node('span','not-found-brand','MILANO');brand.append(node('small','','ENERGY DRINK'));
  const code=node('p','not-found-code','404');code.setAttribute('aria-hidden','true');
  const title=node('h1','',text.title),description=node('p','not-found-copy',text.body),home=node('a','not-found-home',text.home);
  home.dataset.notFoundHome='';home.href=homeHref==='/#top'?homeHref:'/#top';const arrow=node('span','','↗');arrow.setAttribute('aria-hidden','true');home.append(arrow);
  shell.append(brand,code,title,description,home);section.append(shell);
  if(standalone){const button=node('button','not-found-language',locale==='ru'?'EN':'RU');button.type='button';button.dataset.notFoundLanguage='';button.setAttribute('aria-label',text.language);button.addEventListener('click',()=>{const next=locale==='ru'?'en':'ru';try{localStorage.setItem('ml',next)}catch{}document.documentElement.lang=next;render(container,{lang:next,homeHref})});section.append(button)}
  section.setAttribute('translate','no');container.replaceChildren(section);document.title='404 — '+text.title+' · MILANO';
 }
 window.MilanoNotFound=Object.freeze({render});
 const root=document.querySelector('[data-not-found-standalone]');
 if(root){let lang='ru';try{lang=localStorage.getItem('ml')==='en'?'en':'ru'}catch{}document.documentElement.lang=lang;render(root,{lang})}
})();
