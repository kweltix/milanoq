/* Admin operations: private API, text-only rendering, no credentials in storage. */
const MilanoGuard=(()=>{
 const dirty=new Set();
 document.addEventListener('input',e=>{const f=e.target.closest('#ap form');if(f&&!f.elements.q&&!f.hasAttribute('data-no-dirty'))dirty.add(f);});
 document.addEventListener('change',e=>{const f=e.target.closest('#ap form');if(f&&!f.elements.q&&!f.hasAttribute('data-no-dirty'))dirty.add(f);});
 const pending=()=>[...dirty].some(f=>f.isConnected);
 const clear=()=>dirty.clear();
 const leave=()=>!pending()||confirm(document.documentElement.lang==='en'?'Discard unsaved changes?':'Есть несохранённые изменения. Выйти без сохранения?')&&(clear(),true);
 window.addEventListener('beforeunload',e=>{if(pending()){e.preventDefault();e.returnValue='';}});
 document.addEventListener('click',e=>{if(e.target.closest('.side button,.side a,header a,header #lg,header #th')&&!leave()){e.preventDefault();e.stopImmediatePropagation();}},true);
 let acceptedHash=location.hash,restoring=false;
 window.addEventListener('hashchange',e=>{if(restoring){restoring=false;e.stopImmediatePropagation();return;}if(location.hash!==acceptedHash&&!leave()){restoring=true;location.hash=acceptedHash;e.stopImmediatePropagation();return;}acceptedHash=location.hash;},true);
 return {leave,clear,mark:f=>dirty.add(f)};
})();

const MilanoTools=(()=>{
 function render(root,{api,lang,section='overview',openCampaign,userId,campaignId,onBack}){
  const tr=(ru,en)=>lang==='en'?en:ru;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn,cls='btn sm')=>{const b=el('button',text,cls);b.type='button';b.onclick=()=>task(fn);return b;};
  root.replaceChildren();root.classList.add('admin-server');root.setAttribute('translate','no');
  const message=el('p',null,'er'),view=el('div');message.setAttribute('role','status');root.append(el('h1',section==='overview'?tr('Обзор','Overview'):tr('Заявки и выгрузки','Entries and exports')),message,view);
  const errors={invalid_filters:tr('Проверьте диапазон дат.','Check the date range.'),export_too_large:tr('Больше 10 000 строк. Уточните фильтры.','Over 10,000 rows. Narrow the filters.'),campaign_period_exists:tr('Розыгрыш следующего квартала уже существует.','The next quarter already has a giveaway.')};
  let busy=0;const task=async fn=>{busy++;root.setAttribute('aria-busy','true');message.textContent=tr('Загрузка…','Loading…');try{await fn();if(root.isConnected)message.textContent='';}catch(e){if(root.isConnected){message.textContent=errors[e.message]||tr('Не удалось выполнить запрос.','Request failed.');const retry=button(tr('Повторить загрузку','Retry loading'),()=>section==='profile'?profile(userId):listing());message.append(document.createTextNode(' '),retry);}}finally{if(--busy===0)root.setAttribute('aria-busy','false')}};
  const status=s=>({pending:tr('На проверке','Pending'),accepted:tr('Принят','Accepted'),rejected:tr('Отклонён','Rejected'),draft:tr('Черновик','Draft'),open:tr('Открыт','Open'),closed:tr('Закрыт','Closed'),active:tr('Активен','Active'),blocked:tr('Заблокирован','Blocked')})[s]||s;
  const date=s=>s?new Date(s.replace(' ','T')+'Z').toLocaleString(lang==='en'?'en-GB':'ru-RU'): '—';
  const field=(f,label,name,type='text',value='')=>{const l=el('label',label),n=el('input');n.type=type;n.name=name;n.value=value;l.append(n);f.append(l);return n;};
  let filters=campaignId?{campaign:campaignId}:{},page=1,revision=0;
  if(onBack)root.insertBefore(button(tr('← К розыгрышу','← Back to giveaway'),()=>{if(MilanoGuard.leave())onBack()}),view);
  const paging=(parent,more,go)=>{const nav=el('div',null,'admin-actions'),prev=button(tr('Назад','Previous'),()=>go(page-1)),next=button(tr('Далее','Next'),()=>go(page+1));prev.disabled=page===1;next.disabled=!more;nav.append(prev,el('span',tr('Страница ','Page ')+page),next);parent.append(nav);};
  const entryCard=(p,parent,withProfile=true)=>{
   const card=el('section',null,'admin-card');card.append(el('h3',p.name),el('p',p.campaign_title),el('p',p.email+' · '+p.phone),el('p',tr('Email: ','Email: ')+(p.email_verified_at?tr('подтверждён','confirmed'):tr('не подтверждён','unconfirmed'))),el('p',tr('Заявка: ','Entry: ')+status(p.status)+' · '+date(p.submitted_at)),el('p',tr('Чек: ','Receipt: ')+status(p.receipt_status)+' · '+p.original_name));
   if(p.ticket){const l=el('label',tr('Билет','Ticket')),n=el('input');n.readOnly=true;n.value=p.ticket;n.onclick=()=>n.select();l.append(n);card.append(l);}
   card.append(el('p',p.prize?tr('Выигрыш: ','Won: ')+p.prize+' · '+date(p.won_at):tr('Выигрыш не назначен','No prize assigned')));
   if(withProfile)card.append(button(tr('Карточка участника','Participant card'),()=>profile(p.user_id)));
   parent.append(card);
  };
  async function profile(id,p=1){
   const rev=++revision,data=(await api('/admin/accounts/'+id)).data,items=(await api('/admin/tools/entries?'+new URLSearchParams({user:id,page:p,...(campaignId?{campaign:campaignId}:{})}))).data;if(rev!==revision||!root.isConnected)return;
   view.replaceChildren();const u=data.user;view.append(button(tr('К заявкам','Back to entries'),()=>listing()),el('h2',u.name),el('p',u.email),el('p',u.phone),el('p',tr('Почта: ','Email: ')+(u.email_verified?tr('подтверждена','confirmed'):tr('не подтверждена','unconfirmed'))),el('p',tr('Статус аккаунта: ','Account status: ')+status(u.status)));
   items.slice(0,25).forEach(e=>entryCard(e,view,false));if(!items.length)view.append(el('p',tr('Заявок нет','No entries')));page=p;paging(view,items.length>25,n=>profile(id,n));
  }
  async function listing(p=1){
   if(!MilanoGuard.leave())return; page=p;const rev=++revision;
   const [r,campaigns]=await Promise.all([api('/admin/tools/entries?'+new URLSearchParams({...filters,page})),api('/admin/tools/campaign-options')]);if(rev!==revision||!root.isConnected)return;
   view.replaceChildren();const f=el('form',null,'admin-card admin-form');view.append(f);
   field(f,tr('Имя, email или телефон','Name, email or phone'),'q','search',filters.q||'');
   const select=(label,name,options)=>{const l=el('label',label),s=el('select');s.name=name;for(const [value,text]of options){const o=el('option',text);o.value=value;s.append(o);}s.value=filters[name]||'';l.append(s);f.append(l);};
   if(!campaignId)select(tr('Розыгрыш','Giveaway'),'campaign',[['',tr('Все','All')],...campaigns.data.map(c=>[c.id,c.title])]);else f.append(el('p',campaigns.data.find(c=>c.id===campaignId)?.title||tr('Выбранный розыгрыш','Selected giveaway')));select(tr('Статус заявки','Entry status'),'status',[['',tr('Все','All')],...['pending','accepted','rejected'].map(s=>[s,status(s)])]);
   field(f,tr('С даты (Москва)','From date (Moscow)'),'from','date',filters.from||'');field(f,tr('По дату включительно (Москва)','Through date (Moscow)'),'to','date',filters.to||'');
   const submit=el('button',tr('Применить','Apply'),'btn pr');submit.type='submit';f.append(submit);f.onsubmit=e=>{e.preventDefault();filters={...Object.fromEntries(new FormData(f)),...(campaignId?{campaign:campaignId}:{})};MilanoGuard.clear();task(()=>listing());};
   const exports=el('div',null,'admin-actions');view.append(exports,el('p',tr('CSV открывается в Excel. Выгрузка учитывает применённые фильтры и записывается в журнал.','CSV opens in Excel. Exports use applied filters and are audited.'),'hint'));
   for(const [type,title]of [['participants',tr('Участники → CSV','Participants → CSV')],['tickets',tr('Билеты → CSV','Tickets → CSV')],['winners',tr('Победители → CSV','Winners → CSV')]]){
    let busy=false;exports.append(button(title,async()=>{if(busy)return;if(!confirm(tr('Скачать персональные данные? Храните файл в защищённом месте.','Download personal data? Store the file securely.')))return;busy=true;try{const r=await api('/admin/tools/export',{method:'POST',json:{...filters,type}}),url=URL.createObjectURL(new Blob([r.data.csv],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download=r.data.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message.textContent=tr('Выгружено строк: ','Rows exported: ')+r.data.rows;}finally{busy=false;}}));
   }
   r.data.slice(0,25).forEach(e=>entryCard(e,view));if(!r.data.length)view.append(el('p',tr('Заявки не найдены','No entries found')));paging(view,r.data.length>25,n=>listing(n));
  }
  async function overview(){
   const r=(await api('/admin/tools/overview')).data;if(!root.isConnected)return;
   view.replaceChildren();view.append(el('h2',r.campaign?r.campaign.title:tr('Розыгрыша текущего квартала нет','No giveaway for this quarter')));
   if(r.campaign)view.append(el('p',status(r.campaign.status)+' · '+date(r.campaign.starts_at)+' — '+date(r.campaign.ends_at)));
   const grid=el('div',null,'admin-grid');view.append(grid);for(const [key,title]of [['participants',tr('Участники розыгрыша','Giveaway participants')],['receipts',tr('Чеки','Receipts')],['tickets',tr('Билеты','Tickets')],['pending',tr('Заявки на проверке','Pending entries')],['unverified',tr('Аккаунты без подтверждения email','Accounts with unconfirmed email')]]){const c=el('section',null,'admin-card');c.append(el('h3',title),el('p',String(r.counts[key]),'admin-stat'));grid.append(c);}
   view.append(button(tr('Заявки, требующие внимания','Entries needing attention'),()=>{filters={status:'pending',...(r.campaign?{campaign:r.campaign.id}:{})};return listing();}));
   if(r.campaign)view.append(button(tr('Управлять розыгрышем','Manage giveaway'),()=>openCampaign(r.campaign.id)));
  }
  task(()=>section==='overview'?overview():section==='profile'?profile(userId):listing());
 }
 return {render};
})();
