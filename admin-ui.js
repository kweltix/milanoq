/* Server-backed administration. API values are rendered as text, never HTML. */
const MilanoAdmin = window.MilanoAdmin = (() => {
  let selected = null;
  function render(root, {api, lang, campaignId,openCampaign}) {
    const tr = (ru, en) => lang === 'en' ? en : ru;
    const node = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
    const button = (text, action, cls = 'btn sm') => { const b = node('button', text, cls); b.type = 'button'; b.onclick = action; return b; };
    const status = s => ({draft:tr('Черновик','Draft'),scheduled:tr('Запланирован','Scheduled'),open:tr('Открыт','Open'),closed:tr('Закрыт','Closed'),pending:tr('На проверке','Under review'),accepted:tr('Принята','Accepted'),rejected:tr('Отклонена','Rejected')})[s] || s;
    const date = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU',{timeZone:'Europe/Moscow'})+tr(' МСК',' MSK');
    const errors = {
      invalid_credentials:tr('Неверный пароль.','Incorrect password.'), try_later:tr('Подождите несколько секунд.','Wait a few seconds.'),
      admin_required:tr('Нужны права администратора.','Administrator access required.'),login_required:tr('Сессия завершена. Войдите снова.','Session expired. Sign in again.'),
      csrf_failed:tr('Обновите страницу и повторите вход.','Refresh the page and sign in again.'),
      campaign_period_exists:tr('Розыгрыш этого квартала уже существует.','A giveaway already exists for this quarter.'),
      invalid_campaign:tr('Проверьте название, даты, версию правил и статус.','Check the title, dates, rules version and status.'),
      invalid_campaign_quarter:tr('Год и квартал должны совпадать с началом по Москве.','Year and quarter must match the start date in Moscow.'),
      campaign_not_current:tr('Для открытия нужны версия правил и действующий период.','Opening requires a rules version and a currently active date range.'),
      invalid_transition:tr('Закрытый розыгрыш нельзя открыть повторно.','A closed giveaway cannot be reopened.'),
      campaign_closed:tr('Призы закрытого розыгрыша изменять нельзя.','Prizes of a closed giveaway cannot be changed.'),
      invalid_prize:tr('Название: 2–180 символов; количество: 1–1000.','Title: 2–180 characters; quantity: 1–1000.'),
      invalid_winner:tr('Укажите приз, номер места, билет и причину (10–500 символов).','Enter a prize, slot, ticket and reason (10–500 characters).'),
      close_campaign_first:tr('Сначала закройте розыгрыш.','Close the giveaway first.'),
      invalid_prize_slot:tr('Такого призового места нет.','This prize slot does not exist.'),
      ineligible_ticket:tr('Билет не допущен или принадлежит другому розыгрышу.','Ticket is ineligible or belongs to another giveaway.'),
      prize_slot_taken:tr('Это место уже занято победителем.','This prize slot already has a winner.'),
      ticket_already_won:tr('Этот билет уже выиграл.','This ticket has already won.'),
      delete_confirmation_required:tr('Введите название точно как показано.','Type the title exactly as shown.'),campaign_changed:tr('Черновик изменён в другой вкладке. Откройте его заново.','Draft changed in another tab. Reopen it.'),campaign_not_draft:tr('Изменение дат доступно только в черновике.','Dates can only be changed in a draft.'),idempotency_conflict:tr('Запрос уже использован с другими данными. Обновите раздел.','Request key was used with different data. Reload this section.')
    };
    root.replaceChildren(); root.classList.add('admin-server'); root.setAttribute('translate','no');
    const heading = node('h1',tr('Розыгрыши','Giveaways'));
    const notice = node('p',tr('Закрытый раздел • данные сохраняются в MySQL','Private area • data is saved in MySQL'),'hint');
    const nav = node('div',null,'admin-actions'), message = node('p',null,'er'); message.setAttribute('role','status');
    const view = node('div'); root.append(heading,notice,nav,message,view);
    const lookup=node('form',null,'admin-card admin-form'),lookupResult=node('section');lookup.dataset.noDirty='true';lookup.append(node('h2',tr('Найти участника по билету','Find participant by ticket')));
    const ticketInput=node('input');ticketInput.name='ticket';ticketInput.required=true;ticketInput.pattern='[a-fA-F0-9]{32}';ticketInput.placeholder=tr('Полный номер билета','Full ticket ID');ticketInput.setAttribute('aria-label',ticketInput.placeholder);
    const lookupButton=node('button',tr('Найти билет','Find ticket'),'btn pr sm');lookupButton.type='submit';lookup.append(ticketInput,lookupButton,lookupResult);root.insertBefore(lookup,view);
    lookup.onsubmit=async e=>{e.preventDefault();if(lookupButton.disabled)return;lookupButton.disabled=true;lookupResult.textContent=tr('Поиск…','Searching…');try{const d=(await api('/admin/ticket-lookup?'+new URLSearchParams({ticket:ticketInput.value.trim()}))).data;lookupResult.replaceChildren();lookupResult.append(node('h3',d.name),node('p',d.email),node('p',d.phone),node('p',d.ticket,'admin-id'),node('p',d.campaign_title),button(tr('Открыть участника','Open participant'),()=>{if(openCampaign)openCampaign(d.campaign_id,d.user_id)}));}catch(err){lookupResult.textContent=err.message==='ticket_not_found'?tr('Билет не найден. Проверьте номер.','Ticket not found. Check the ID.'):err.message==='invalid_ticket'?tr('Введите полный номер билета: 32 символа.','Enter the full 32-character ticket ID.'):tr('Поиск не завершён. Повторите запрос.','Search failed. Retry.');}finally{lookupButton.disabled=false}};
    let revision = 0, campaignQuery='', campaignStatus='', pendingTasks=0, selectedTitle='';
    const error = e => { if(root.isConnected) message.textContent = errors[e.message] || tr('Не удалось выполнить запрос. Проверьте соединение и повторите.','Request failed. Check the connection and try again.'); };
    const retry=button(tr('Повторить загрузку','Retry loading'),()=>task(()=>selected?detail(selected):campaigns()));retry.hidden=true;root.insertBefore(retry,view);
    const task = async fn => { pendingTasks++;root.setAttribute('aria-busy','true');message.textContent=tr('Загрузка…','Loading…');retry.hidden=true;try { await fn();if(message.isConnected)message.textContent=''; } catch(e) { error(e);retry.hidden=false; }finally{if(--pendingTasks===0)root.setAttribute('aria-busy','false')} };
    const field = (form, label, name, type='text', value='', required=true) => {
      const wrap=node('label',label), input=node(type==='textarea'?'textarea':'input');
      if(type!=='textarea') input.type=type;
      input.name=name;input.value=value;input.required=required;wrap.append(input);form.append(wrap);return input;
    };
    const form = (parent, title, action) => {
      const f=node('form',null,'admin-card admin-form');f.append(node('h3',title));parent.append(f);
      f.onsubmit=e=>{e.preventDefault(); if(f.dataset.busy)return; f.dataset.busy='1'; const controls=[...f.querySelectorAll('button')];controls.forEach(b=>b.disabled=true); task(()=>action(f)).finally(()=>{delete f.dataset.busy;controls.forEach(b=>b.disabled=false)});};return f;
    };
    const submit = (f,label) => {const b=node('button',label,'btn pr');b.type='submit';f.append(b);};
    const values=f=>Object.fromEntries(new FormData(f));
    const pager=(parent,page,more,go)=>{const p=node('div',null,'admin-actions');const prev=button(tr('Назад','Previous'),()=>task(()=>go(page-1)));prev.disabled=page===1;const next=button(tr('Далее','Next'),()=>task(()=>go(page+1)));next.disabled=!more;p.append(prev,node('span',tr('Страница ','Page ')+page),next);parent.append(p);};
    async function campaigns(page=1) {
      if(!MilanoGuard.leave())return;
      selected=null;const rev=++revision; const r=await api('/admin/campaigns?'+new URLSearchParams({page,q:campaignQuery,status:campaignStatus}));if(!root.isConnected||rev!==revision)return;
      view.replaceChildren();const search=node('form',null,'admin-card admin-form');view.append(search);field(search,tr('Найти розыгрыш','Find giveaway'),'q','search',campaignQuery,false);const label=node('label',tr('Статус','Status')),filter=node('select');filter.name='status';for(const value of ['','draft','scheduled','open','closed']){const o=node('option',value?status(value):tr('Все','All'));o.value=value;filter.append(o)}filter.value=campaignStatus;label.append(filter);search.append(label);submit(search,tr('Применить','Apply'));search.onsubmit=e=>{e.preventDefault();campaignQuery=search.elements.q.value;campaignStatus=filter.value;MilanoGuard.clear();task(()=>campaigns())};const list=node('div',null,'admin-grid');view.append(list);
      r.data.slice(0,25).forEach(c=>{const card=node('section',null,'admin-card campaign-card');card.append(node('h2',c.title),node('p',`${c.year} · Q${c.quarter} · ${status(c.status)}`),node('p',`${date(c.starts_at)} — ${date(c.ends_at)}`,'hint'));const counts=node('dl',null,'campaign-counts');for(const [key,title]of [['participants',tr('Участники','Participants')],['receipts',tr('Чеки','Receipts')],['tickets',tr('Билеты','Tickets')],['pending',tr('На проверке','Pending')]]){const item=node('div');item.append(node('dt',title),node('dd',String(c[key]??0)));counts.append(item)}card.append(counts,button(tr('Открыть розыгрыш','Open giveaway'),()=>task(()=>detail(c.id)),'btn pr sm'));list.append(card);});
      if(!r.data.length)view.append(node('p',tr('Розыгрышей пока нет. Создайте первый.','No giveaways yet. Create the first one.')));
      pager(view,page,r.data.length>25,campaigns);
    }
    function create() {
      if(!MilanoGuard.leave())return;
      ++revision;view.replaceChildren();const now=new Date();
      const f=form(view,tr('Новый розыгрыш','New giveaway'),async f=>{const v=values(f);const r=await api('/admin/campaigns',{method:'POST',json:{...v,year:+v.year,quarter:+v.quarter,starts_at:new Date(v.starts_at+':00+03:00').toISOString().replace('.000',''),ends_at:new Date(v.ends_at+':00+03:00').toISOString().replace('.000',''),status:'draft'}});MilanoGuard.clear();await detail(r.data.id);});
      const title=field(f,tr('Название','Title'),'title');title.minLength=3;title.maxLength=180;
      const y=field(f,tr('Год','Year'),'year','number',now.getFullYear());y.min=2020;y.max=2100;
      const q=field(f,tr('Квартал','Quarter'),'quarter','number',Math.floor(now.getMonth()/3)+1);q.min=1;q.max=4;
      field(f,tr('Начало — Москва (UTC+3)','Start — Moscow (UTC+3)'),'starts_at','datetime-local');
      field(f,tr('Окончание — Москва (UTC+3)','End — Moscow (UTC+3)'),'ends_at','datetime-local');
      field(f,tr('Версия утверждённых правил','Approved rules version'),'rules_version').maxLength=80;
      f.append(node('p',tr('Создаётся черновик. Добавьте призы, затем откройте приём заявок. На квартал — один розыгрыш.','A draft will be created. Add prizes, then open entries. One giveaway per quarter.'),'hint'));submit(f,tr('Создать черновик','Create draft'));
    }
    async function detail(id) {
      if(openCampaign){openCampaign(id);return;}
      if(!MilanoGuard.leave())return;
      selected=id;const rev=++revision;const r=await api('/admin/campaigns/'+id);if(!root.isConnected||rev!==revision)return;
      const {campaign:c,counts,prizes,winners}=r.data;selectedTitle=c.title;view.replaceChildren();const base='/admin/campaigns/'+id;
      view.append(node('h2',c.title),node('p',`${status(c.status)} · ${tr('Участники','Participants')}: ${counts.participants} · ${tr('Билеты','Tickets')}: ${counts.tickets}`));
      const actions=node('div',null,'admin-actions');view.append(actions);
      actions.append(button(tr('Копировать на следующий квартал','Copy to next quarter'),()=>{if(confirm(tr('Создать черновик следующего квартала с этими призами? Участники и билеты не переносятся. Правила нужно проверить заново.','Create a next-quarter draft with these prizes? Participants and tickets are not copied. Review the rules again.')))task(async()=>{if(!MilanoGuard.leave())return;const r=await api('/admin/tools/campaigns/'+id+'/copy',{method:'POST',json:{}});await detail(r.data.id);});}));
      if(c.status==='draft'){
        const local=value=>{const d=new Date(value.replace(' ','T')+'Z');return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
        const f=form(view,tr('Название, даты и правила черновика','Draft title, dates and rules'),async f=>{const v=values(f);await api('/admin/tools/campaigns/'+id,{method:'PATCH',json:{...v,starts_at:new Date(v.starts_at).toISOString().replace('.000',''),ends_at:new Date(v.ends_at).toISOString().replace('.000',''),expected_starts_at:c.starts_at,expected_ends_at:c.ends_at,expected_title:c.title,expected_rules_version:c.rules_version}});MilanoGuard.clear();await detail(id);});
        field(f,tr('Название','Title'),'title','text',c.title).maxLength=180;field(f,tr('Начало (часовой пояс устройства)','Start (device time zone)'),'starts_at','datetime-local',local(c.starts_at));field(f,tr('Окончание (часовой пояс устройства)','End (device time zone)'),'ends_at','datetime-local',local(c.ends_at));field(f,tr('Версия правил — проверить перед открытием','Rules version — review before opening'),'rules_version','text',c.rules_version||'',false).maxLength=80;submit(f,tr('Сохранить настройки','Save settings'));
      }
      if(c.status==='draft')actions.append(button(tr('Открыть розыгрыш','Open giveaway'),()=>task(async()=>{if(!MilanoGuard.leave())return;await api(base+'/open',{method:'POST',json:{}});await detail(id);}),'btn pr sm'));
      if(c.status!=='closed')actions.append(button(tr('Закрыть розыгрыш','Close giveaway'),()=>{if(confirm(tr('Закрыть приём заявок? Повторное открытие невозможно.','Close entries? This cannot be reopened.')))task(async()=>{if(!MilanoGuard.leave())return;await api(base+'/close',{method:'POST',json:{}});await detail(id);});}));
      actions.append(button(tr('Участники и билеты','Participants and tickets'),()=>task(()=>participants(id))));
      actions.append(button(tr('Заявки, чеки и выгрузки','Entries, receipts and exports'),()=>{if(!MilanoGuard.leave())return;++revision;view.replaceChildren();const nested=node('div');view.append(nested);MilanoTools.render(nested,{api,lang,section:'entries',campaignId:id,onBack:()=>task(()=>detail(id))})}));
      actions.append(button(tr('Журнал розыгрыша','Giveaway audit'),()=>task(()=>audit(1,id))));
      if(c.status!=='open')actions.append(button(tr('Удалить розыгрыш полностью','Delete giveaway permanently'),()=>{
        if(!MilanoGuard.leave())return;
        ++revision;view.replaceChildren();
        const f=form(view,tr('Полное удаление розыгрыша','Permanently delete giveaway'),async f=>{
          if(!confirm(tr('Удалить этот розыгрыш и все его заявки, чеки, билеты, призы и результаты? Отмены в админке нет.','Delete this giveaway and all its entries, receipts, tickets, prizes and results? There is no undo in the admin panel.')))return;
          const r=await api('/admin/tools/campaigns/'+id,{method:'DELETE',json:values(f)});f.elements.current_password.value='';MilanoGuard.clear();selected=null;await campaigns();message.textContent=r.data.pending_files?tr('Розыгрыш удалён. Файлов в очереди очистки: ','Giveaway deleted. Receipt files pending cleanup: ')+r.data.pending_files:tr('Розыгрыш полностью удалён. Аккаунты и журнал сохранены.','Giveaway permanently deleted. Accounts and audit log retained.');
        });
        f.append(node('p',tr('Удаляется: ','Deleting: ')+c.title),node('p',tr('Сначала сохраните резервную копию. Удаление необратимо в интерфейсе. Аккаунты, согласия и журнал действий останутся.','Make a backup first. There is no undo in the interface. Accounts, consents and audit log remain.'),'hint'));
        field(f,tr('Введите точное название розыгрыша','Type the exact giveaway title'),'confirmation').maxLength=180;
        field(f,tr('Ваш пароль администратора','Your administrator password'),'current_password','password').autocomplete='current-password';
        submit(f,tr('Удалить безвозвратно','Delete permanently'));f.querySelector('[type=submit]').classList.add('admin-danger');f.append(button(tr('Отмена','Cancel'),()=>task(()=>detail(id))));
        scrollTo(0,Math.max(0,root.getBoundingClientRect().top+scrollY-(document.querySelector('header')?.getBoundingClientRect().height||0)-16));
      },'btn sm admin-danger-outline'));
      view.append(node('h3',tr('Призы','Prizes')));
      const grid=node('div',null,'admin-grid');view.append(grid);
      prizes.forEach(p=>{const card=node('section',null,'admin-card');card.append(node('h4',p.title),node('p',tr('Количество: ','Quantity: ')+p.quantity));
        if(c.status!=='closed'){
          card.append(button(tr('Редактировать','Edit'),()=>prizeForm(base,p)),button(tr('Удалить','Delete'),()=>{if(confirm(tr('Удалить этот приз?','Delete this prize?')))task(async()=>{await api(base+'/prizes/'+p.id,{method:'DELETE'});await detail(id);});}));
        }grid.append(card);});
      if(!prizes.length)grid.append(node('p',tr('Призов пока нет.','No prizes yet.')));
      if(c.status!=='closed')view.append(button(tr('Добавить приз','Add prize'),()=>prizeForm(base)));
      view.append(node('h3',tr('Победители','Winners')));
      winners.forEach(w=>{const card=node('section',null,'admin-card');card.append(node('h4',w.name+' — '+w.title),node('p',tr('Место ','Slot ')+w.prize_slot+' · '+date(w.assigned_at)),node('p',w.ticket,'admin-id'),node('p',tr('Причина: ','Reason: ')+w.reason));view.append(card);});
      if(!winners.length)view.append(node('p',tr('Победители ещё не назначены.','No winners assigned yet.')));
      if(c.status==='closed'&&prizes.length){
        const key=crypto.randomUUID().replaceAll('-','');
        const f=form(view,tr('Назначить победителя вручную','Assign a winner manually'),async f=>{const v=values(f);if(!confirm(tr('Назначить этому билету выбранный приз? Отмены в админке нет.','Assign this prize to this ticket? There is no undo in the admin panel.')))return;await api(base+'/winners',{method:'POST',headers:{'Idempotency-Key':key},json:{...v,prize_id:+v.prize_id,prize_slot:+v.prize_slot}});f.elements.password.value='';MilanoGuard.clear();await detail(id);});
        const label=node('label',tr('Приз','Prize')),select=node('select');select.name='prize_id';select.required=true;prizes.forEach(p=>{const o=node('option',p.title+' × '+p.quantity);o.value=p.id;select.append(o);});label.append(select);f.append(label);
        const slot=field(f,tr('Номер призового места','Prize slot number'),'prize_slot','number',1);slot.min=1;slot.max=prizes[0].quantity;select.onchange=()=>{slot.max=prizes.find(p=>String(p.id)===select.value).quantity;slot.value=1;};
        field(f,tr('Номер билета (из списка участников)','Ticket ID (from participants list)'),'ticket').pattern='[a-f0-9]{32}';
        const reason=field(f,tr('Причина ручного выбора','Reason for manual selection'),'reason','textarea');reason.minLength=10;reason.maxLength=500;
        field(f,tr('Ваш пароль администратора','Your administrator password'),'password','password').autocomplete='current-password';
        f.append(node('p',tr('Назначение окончательное и записывается в журнал. Это ручной выбор, а не случайный розыгрыш.','Assignment is final and recorded in the audit log. This is manual selection, not a random draw.'),'hint'));submit(f,tr('Подтвердить назначение','Confirm assignment'));
      }else if(c.status!=='closed')view.append(node('p',tr('Ручной выбор доступен после закрытия розыгрыша.','Manual selection becomes available after closing the giveaway.'),'hint'));
    }
    function prizeForm(base,p=null){
      if(!MilanoGuard.leave())return;
      ++revision;view.replaceChildren();const f=form(view,p?tr('Редактировать приз','Edit prize'):tr('Новый приз','New prize'),async f=>{const v=values(f);await api(base+'/prizes'+(p?'/'+p.id:''),{method:p?'PATCH':'POST',json:{title:v.title,quantity:+v.quantity}});MilanoGuard.clear();await detail(selected);});
      const title=field(f,tr('Название приза','Prize title'),'title','text',p?.title||'');title.minLength=2;title.maxLength=180;
      const q=field(f,tr('Количество','Quantity'),'quantity','number',p?.quantity||1);q.min=1;q.max=1000;submit(f,tr('Сохранить','Save'));f.append(button(tr('Отмена','Cancel'),()=>task(()=>detail(selected))));
    }
    async function participants(id,page=1,q=''){
      if(!MilanoGuard.leave())return;
      const rev=++revision;const r=await api('/admin/campaigns/'+id+'/participants?page='+page+'&q='+encodeURIComponent(q));if(!root.isConnected||rev!==revision)return;
      view.replaceChildren();view.append(node('h2',tr('Участники и билеты','Participants and tickets')),button(tr('К розыгрышу','Back to giveaway'),()=>task(()=>detail(id))));
      const f=form(view,tr('Поиск','Search'),async f=>participants(id,1,values(f).q));field(f,tr('Имя, телефон или email','Name, phone or email'),'q','search',q,false);submit(f,tr('Найти','Search'));
      r.data.slice(0,25).forEach(p=>{const card=node('section',null,'admin-card');card.append(node('h3',p.name),node('p',p.email),node('p',p.phone),node('p',date(p.joined_at),'hint'));p.entries.forEach(e=>{card.append(node('p',status(e.status)));if(e.ticket){const label=node('label',tr('Билет — выделите и скопируйте','Ticket — select and copy'));const input=node('input');input.readOnly=true;input.value=e.ticket;input.onclick=()=>input.select();label.append(input);card.append(label);}});view.append(card);});
      if(!r.data.length)view.append(node('p',tr('Участники не найдены.','No participants found.')));pager(view,page,r.data.length>25,p=>participants(id,p,q));
    }
    async function audit(page=1,id=selected){
      if(!MilanoGuard.leave())return;
      const rev=++revision;const r=await api('/admin/audit?'+new URLSearchParams({page,...(id?{campaign:id}:{})}));if(!root.isConnected||rev!==revision)return;view.replaceChildren();view.append(node('h2',tr('Журнал розыгрыша','Giveaway audit')),node('p',selectedTitle));if(id)view.append(button(tr('← К розыгрышу','← Back to giveaway'),()=>task(()=>detail(id))));
      const labels={'campaign.delete':tr('Розыгрыш полностью удалён','Giveaway permanently deleted'),'demo.seed':tr('Добавлены тестовые участники','Test participants loaded'),'campaign.copy':tr('Копирование розыгрыша','Giveaway copied'),'campaign.update':tr('Настройки розыгрыша изменены','Giveaway settings changed'),'data.export':tr('Выгрузка данных','Data exported'),'campaign.create':tr('Создание розыгрыша','Giveaway created'),'campaign.open':tr('Открытие розыгрыша','Giveaway opened'),'campaign.close':tr('Закрытие розыгрыша','Giveaway closed'),'prize.create':tr('Добавление приза','Prize added'),'prize.update':tr('Изменение приза','Prize updated'),'prize.delete':tr('Удаление приза','Prize deleted'),'winner.manual':tr('Ручное назначение победителя','Winner manually assigned')};for(const [key,label]of Object.entries({'cms.products.create':tr('Создан вкус','Flavor created'),'cms.products.update':tr('Изменён вкус','Flavor updated'),'cms.products.archive':tr('Вкус в архиве','Flavor archived'),'cms.products.restore':tr('Вкус восстановлен','Flavor restored'),'cms.articles.create':tr('Создана статья','Article created'),'cms.articles.update':tr('Изменена статья','Article updated'),'cms.articles.archive':tr('Статья в архиве','Article archived'),'cms.articles.restore':tr('Статья восстановлена','Article restored'),'cms.partners.status':tr('Статус партнёрской заявки','Partner request status'),'cms.partners.archive':tr('Партнёрская заявка в архиве','Partner request archived'),'cms.partners.restore':tr('Партнёрская заявка восстановлена','Partner request restored'),'cms.media.upload':tr('Загружено изображение','Image uploaded'),'cms.settings.update':tr('Настройки сайта изменены','Site settings updated'),'cms.legacy.import':tr('Контент перенесён из браузера','Browser content imported')}))labels[key]=label;
      r.data.slice(0,25).forEach(a=>{const card=node('section',null,'admin-card');card.append(node('h3',labels[a.action]||a.action),node('p',a.actor+' · '+date(a.created_at)),node('p',`${a.entity_type} #${a.entity_id}`,'hint'));if(a.details_json){const details=node('details');details.append(node('summary',tr('Подробности','Details')),node('pre',JSON.stringify(JSON.parse(a.details_json),null,2)));card.append(details);}view.append(card);});
      if(!r.data.length)view.append(node('p',tr('Журнал пока пуст.','The audit log is empty.')));pager(view,page,r.data.length>25,p=>audit(p,id));
    }
    nav.append(button(tr('Все розыгрыши','All giveaways'),()=>task(()=>campaigns())),button(tr('Создать','Create'),create,'btn pr sm'));
    task(()=>campaignId?detail(campaignId):campaigns());
  }
  return {render};
})();
