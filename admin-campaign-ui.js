/* Private campaign workspace. Untrusted values always enter the DOM as text. */
window.MilanoCampaign = (() => {
  function render(root, options) {
    const {api, lang = 'ru', campaignId, onBack, onExport, onNavigateCampaign} = options;
    root._milanoCampaignCleanup?.();
    const tr = (ru, en) => lang === 'en' ? en : ru;
    const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
    const button = (text, fn, cls = 'btn sm') => { const b = el('button', text, cls); b.type = 'button'; b.onclick = fn; return b; };
    const guard = () => typeof MilanoGuard === 'undefined' || MilanoGuard.leave();
    const clearDirty = () => { if (typeof MilanoGuard !== 'undefined') MilanoGuard.clear(); };
    const markDirty = f => { if (typeof MilanoGuard !== 'undefined') MilanoGuard.mark(f); };
    const unpack = r => r?.data ?? r;
    const rows = r => { const d = unpack(r); return Array.isArray(d) ? d : d?.rows || []; };
    const eligible = value => value === true || value === 1 || value === '1';
    const ticketLabel=t=>t.draw_eligible?tr('Допущен к выбору','Eligible for selection'):({participant_already_won:tr('Участник уже выиграл','Participant has already won'),ticket_revoked:tr('Билет отозван','Ticket revoked'),receipt_unapproved:tr('Чек не подтверждён','Receipt not approved'),account_blocked:tr('Аккаунт заблокирован','Account blocked'),email_unverified:tr('Почта не подтверждена','Email not verified'),participant_excluded:tr('Участник исключён','Participant excluded')})[t.eligibility_reason]||tr('Не входит в допустимый список','Outside the eligible pool');
    const utc = s => { if (!s) return null; const v = String(s).replace(' ', 'T'); return new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(v) ? v : v + 'Z'); };
    const date = s => { const d = utc(s); return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', {timeZone:'Europe/Moscow'}) + tr(' МСК',' MSK') : '—'; };
    const moscowInput = s => { const d = utc(s); return d && !Number.isNaN(d.getTime()) ? new Date(d.getTime() + 10800000).toISOString().slice(0,16) : ''; };
    const fromMoscow = s => new Date(s + ':00+03:00').toISOString().replace('.000','');
    const status = s => ({draft:tr('Черновик','Draft'),scheduled:tr('Запланирован','Scheduled'),open:tr('Приём открыт','Entries open'),closed:tr('Закрыт','Closed'),pending:tr('На проверке','Pending'),accepted:tr('Принята','Accepted'),rejected:tr('Отклонена','Rejected'),active:tr('Активен','Active'),blocked:tr('Заблокирован','Blocked'),cancelled:tr('Отменён','Cancelled'),verified:tr('Подтверждён','Verified'),unverified:tr('Не подтверждён','Unverified'),not_configured:tr('Не подключено','Not connected'),not_started:tr('Не запущено','Not started'),processing:tr('Обрабатывается','Processing'),failed:tr('Не удалось распознать','Recognition failed'),matched:tr('Товары определены','Products matched')})[s] || s || '—';
    const errorText = error => ({login_required:tr('Сессия завершена. Войдите снова.','Your session has expired. Sign in again.'),admin_required:tr('Нужны права администратора.','Administrator access required.'),csrf_failed:tr('Обновите страницу и повторите вход.','Refresh this page and sign in again.'),campaign_changed:tr('Кампания изменена в другой вкладке. Обновите карточку перед сохранением.','The campaign changed in another tab. Reload it before saving.'),invalid_campaign:tr('Проверьте название, московские даты и версию правил.','Check the title, Moscow dates and rules version.'),invalid_campaign_quarter:tr('Начало должно оставаться в выбранном году и квартале по Москве.','The start must remain in the selected Moscow year and quarter.'),campaign_not_draft:tr('Настройки доступны только в черновике.','Only a draft can be edited.'),invalid_transition:tr('Изменение статуса недоступно. Обновите карточку.','This status change is unavailable. Reload the workspace.'),campaign_period_exists:tr('Кампания следующего квартала уже существует.','The next quarter campaign already exists.'),campaign_closed:tr('Призы закрытой кампании изменять нельзя.','Prizes cannot be edited after closing.'),invalid_prize:tr('Название приза: 2–180 символов; количество: 1–1000.','Prize title: 2–180 characters; quantity: 1–1000.'),invalid_credentials:tr('Неверный пароль.','Incorrect password.'),delete_confirmation_required:tr('Введите точное название кампании.','Type the exact campaign title.'),invalid_filters:tr('Проверьте период фильтра.','Check the filter date range.'),export_too_large:tr('Слишком много строк. Уточните фильтры и повторите выгрузку.','Too many rows. Narrow the filters before exporting.'),timeout:tr('Время ожидания истекло. Проверьте результат перед повтором изменения.','The request timed out. Check the saved state before repeating a change.'),network_error:tr('Нет связи с сервером.','Cannot connect to the server.')})[error?.message] || tr('Не удалось выполнить запрос. Проверьте соединение и повторите загрузку.','The request failed. Check your connection and retry loading.');
    const base = '/admin/workspace/' + encodeURIComponent(campaignId);
    const actionError = error => ({campaign_not_ready:tr('Для открытия нужны призы, версия правил и неистёкший период кампании.','Opening requires prizes, a rules version and a campaign period that has not ended.'),reason_required:tr('Укажите причину длиной 10–500 символов.','Enter a reason of 10–500 characters.'),pool_frozen:tr('Пул уже зафиксирован. Исходные заявки больше не меняются.','The pool is frozen. Source entries can no longer change.'),request_timeout:tr('Сервер не ответил вовремя. Перед повтором изменения обновите сохранённые данные.','The request timed out. Refresh saved data before repeating a change.')})[error?.message] || errorText(error);
    const savedKey='milano.admin.campaign.'+campaignId;
    let saved={};try{saved=JSON.parse(sessionStorage.getItem(savedKey)||'{}')}catch(_){}
    let campaign = null, data = null, tab = ['summary','participants','tickets','prizes','settings','audit'].includes(saved.tab)?saved.tab:'summary', revision = 0, viewController = new AbortController(), disposed = false, writeBusy = false, drawCleanup = null;
    const filters = {participants:{q:'',status:'',from:'',to:'',...saved.filters?.participants},tickets:{q:'',status:'',from:'',to:'',...saved.filters?.tickets}};
    let participantMode = saved.participantMode==='participants'?'participants':'entries';
    const pages={participants:1,tickets:1,audit:1,...saved.pages};
    const remember=()=>{try{sessionStorage.setItem(savedKey,JSON.stringify({tab,filters,participantMode,pages}));}catch(_){}};
    const lifetime = new AbortController();
    const alive = rev => !disposed && root.isConnected && (rev == null || rev === revision);
    const request = async (path, opts = {}) => api(path, {...opts, signal: opts.signal || viewController.signal});
    root.replaceChildren(); root.classList.add('admin-server','campaign-workspace'); root.setAttribute('translate','no');
    const header = el('div',null,'cw-header'), titleBlock = el('div'), title = el('h1',tr('Кампания','Campaign')), subtitle = el('p',null,'hint');
    const back = button(tr('← Все кампании','← All campaigns'),() => { if (!writeBusy && guard()) { cleanup(); onBack?.(); } },'cw-back');
    titleBlock.append(back,title,subtitle);
    const refresh=button(tr('Обновить данные','Refresh data'),()=>{if(!writeBusy&&guard())load();},'btn sm');titleBlock.append(refresh);
    const exportBox = el('div',null,'cw-export'), exportLabel = el('label',tr('Excel','Excel')), scope = el('select');
    scope.setAttribute('aria-label',tr('Область выгрузки','Export scope'));
    for (const [value,label] of [['all',tr('Вся кампания','Entire campaign')],['filtered',tr('Текущие фильтры','Current filters')]]) { const o=el('option',label);o.value=value;scope.append(o); }
    exportLabel.append(scope);
    const exportButton = button(tr('Скачать .xlsx','Download .xlsx'),async () => {
      if (exportButton.disabled) return;
      const source = tab === 'tickets' ? filters.tickets : filters.participants;
      exportButton.disabled=true; message.textContent=tr('Готовим Excel…','Preparing Excel…');
      try { if (typeof onExport !== 'function') throw new Error('export_unavailable'); await onExport({campaignId,scope:scope.value,filters:scope.value === 'filtered' ? {...source} : {},lang,signal:lifetime.signal}); if(alive()) message.textContent=tr('Файл Excel готов.','The Excel file is ready.'); }
      catch(e) { if(alive() && e.name !== 'AbortError') message.textContent=e.message==='export_unavailable'?tr('Выгрузка сейчас недоступна.','Export is currently unavailable.'):actionError(e); }
      finally { if(alive()) exportButton.disabled=false; }
    },'btn pr sm');
    exportBox.append(exportLabel,exportButton); header.append(titleBlock,exportBox);
    const message = el('p',null,'cw-message'); message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
    const tabs = el('nav',null,'cw-tabs'); tabs.setAttribute('aria-label',tr('Разделы кампании','Campaign sections'));
    const panel = el('section',null,'cw-panel');panel.setAttribute('aria-live','polite');
    const tabButtons = new Map();
    for (const [id,label] of [['summary',tr('Сводка','Summary')],['participants',tr('Участники и чеки','Participants & receipts')],['tickets',tr('Билеты','Tickets')],['prizes',tr('Призы и победители','Prizes & winners')],['settings',tr('Настройки','Settings')],['audit',tr('Журнал','Audit')]]) {
      const b=button(label,()=>navigate(id),'cw-tab');b.dataset.tab=id;tabButtons.set(id,b);tabs.append(b);
    }
    root.append(header,message,tabs,panel);
    function cleanup() { if(disposed)return;disposed=true;++revision;viewController.abort();lifetime.abort();drawCleanup?.();observer.disconnect();if(root._milanoCampaignCleanup===cleanup)delete root._milanoCampaignCleanup; }
    root._milanoCampaignCleanup=cleanup;
    const observer=new MutationObserver(()=>{if(!root.isConnected)cleanup();});observer.observe(document.body,{childList:true,subtree:true});
    const begin = () => { drawCleanup?.();drawCleanup=null;viewController.abort();viewController=new AbortController();++revision;panel.replaceChildren();message.textContent='';panel.setAttribute('aria-busy','true');panel.append(el('p',tr('Загрузка…','Loading…'),'cw-loading'));return revision; };
    function failure(error,retry,rev) { if(!alive(rev)||error.name==='AbortError')return;panel.replaceChildren();const box=el('div',null,'cw-state cw-state-error');box.append(el('p',actionError(error)));if(retry)box.append(button(tr('Повторить загрузку','Retry loading'),retry,'btn pr sm'));panel.append(box);panel.setAttribute('aria-busy','false'); }
    function refreshHeader() { title.textContent=campaign.title;subtitle.textContent=`${campaign.year} · Q${campaign.quarter} · ${status(campaign.status)}`; }
    let initialUserId=options.initialUserId;
    async function load() { const rev=begin();try{data=unpack(await request(base));if(!alive(rev))return;campaign=data.campaign;refreshHeader();if(initialUserId){const id=initialUserId;initialUserId=null;tab='participants';remember();await profile(id);}else await show(tab,rev);}catch(e){failure(e,load,rev);} }
    async function navigate(next,force=false) { if(writeBusy||!campaign||(!force&&!guard()))return;tab=next;remember();const rev=begin();await show(next,rev); }
    async function show(next,rev) {
      for(const [id,b]of tabButtons){b.classList.toggle('active',id===next);if(id===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
      try { if(next==='summary')summary();else if(next==='settings')settings();else if(next==='participants')await listing('participants',pages.participants,rev);else if(next==='tickets')await listing('tickets',pages.tickets,rev);else if(next==='prizes')prizes();else await audit(pages.audit,rev);if(alive(rev))panel.setAttribute('aria-busy','false'); }
      catch(e){failure(e,()=>navigate(next,true),rev);}
    }
    async function write(control,fn,success) {
      if(writeBusy)return;writeBusy=true;message.textContent=tr('Сохранение…','Saving…');const rev=revision;
      const controls=[...root.querySelectorAll('button, input, select, textarea')];const disabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);
      try { const result=await fn();if(!alive(rev))return;clearDirty();message.textContent=tr('Сохранено.','Saved.');await success?.(result); }
      catch(e){if(alive(rev)&&e.name!=='AbortError'){message.textContent=actionError(e);if(control)control.focus();}}
      finally { writeBusy=false;if(alive()){controls.forEach((n,i)=>{if(n.isConnected)n.disabled=disabled[i];});} }
    }
    function makeForm(parent,heading,onSubmit) {
      const f=el('form',null,'admin-card admin-form cw-form');if(heading)f.append(el('h3',heading));
      f.addEventListener('input',()=>markDirty(f),{signal:viewController.signal});f.addEventListener('change',()=>markDirty(f),{signal:viewController.signal});
      f.onsubmit=e=>{e.preventDefault();if(!f.reportValidity())return;onSubmit(f);};parent.append(f);return f;
    }
    function field(f,label,name,type='text',value='',required=true) { const l=el('label',label),n=el(type==='textarea'?'textarea':'input');if(type!=='textarea')n.type=type;n.name=name;n.value=value??'';n.required=required;l.append(n);f.append(l);return n; }
    function submit(f,label,cls='btn pr') { const b=el('button',label,cls);b.type='submit';f.append(b);return b; }
    const values=f=>Object.fromEntries(new FormData(f));
    function pair(parent,label,value) { const d=el('div');d.append(el('dt',label),el('dd',value??'—'));parent.append(d); }
    function summary() {
      panel.replaceChildren();const stats=el('dl',null,'cw-stats');
      for(const [key,label]of [['participants',tr('Участники','Participants')],['receipts',tr('Чеки','Receipts')],['tickets',tr('Билеты','Tickets')],['pending',tr('На проверке','Pending')],['winners',tr('Победители','Winners')]])pair(stats,label,String(data.counts?.[key]??0));
      const info=el('section',null,'admin-card');info.append(el('h2',tr('Период кампании','Campaign period')));const dl=el('dl',null,'cw-details');pair(dl,tr('Начало','Starts'),date(campaign.starts_at));pair(dl,tr('Окончание','Ends'),date(campaign.ends_at));pair(dl,tr('Правила','Rules'),campaign.rules_version||tr('Не утверждены','Not approved'));pair(dl,tr('Пул билетов','Ticket pool'),campaign.pool_frozen_at?tr('Зафиксирован ','Frozen ')+date(campaign.pool_frozen_at):tr('Ещё не зафиксирован','Not frozen yet'));info.append(dl);
      const recognition=el('section',null,'admin-card cw-notice');recognition.append(el('h2',tr('Проверка чеков','Receipt verification')),el('p',data.recognition?.configured?tr('Подсчёт товаров выполняется автоматически после распознавания чека.','Product quantities are counted automatically after receipt recognition.'):tr('Чеки появляются в разделе «Участники и чеки». Откройте файл, укажите количество банок MILANO и подтвердите: 3 банки — 3 билета. Автоматическая проверка code-qr.ru пока не подключена.','Receipts appear under Participants & receipts. Open the file, enter the number of MILANO cans and approve: 3 cans means 3 tickets. Automatic code-qr.ru verification is not connected yet.')),button(tr('Посмотреть участников и чеки','View participants & receipts'),()=>navigate('participants')),button(tr('Только ожидающие проверки','Pending reviews only'),()=>{participantMode='entries';filters.participants.status='pending';pages.participants=1;navigate('participants');}));
      panel.append(stats,info,recognition);
    }
    function filterForm(kind,parent) {
      const current=filters[kind],f=el('form',null,'cw-filters');
      field(f,tr('Билет, имя, email или телефон','Ticket, name, email or phone'),'q','search',current.q,false);
      const l=el('label',kind==='tickets'?tr('Статус заявки','Entry status'):tr('Статус','Status')),s=el('select');s.name='status';
      for(const v of ['','pending','accepted','rejected']){const o=el('option',v?status(v):tr('Все','All'));o.value=v;s.append(o);}s.value=current.status;l.append(s);f.append(l);
      field(f,tr('С даты (МСК)','From date (MSK)'),'from','date',current.from,false);field(f,tr('По дату (МСК)','Through date (MSK)'),'to','date',current.to,false);submit(f,tr('Применить','Apply'),'btn pr sm');
      f.append(button(tr('Сбросить','Reset'),()=>{filters[kind]={q:'',status:'',from:'',to:''};clearDirty();reloadList(kind,1);}));
      f.onsubmit=e=>{e.preventDefault();filters[kind]=values(f);clearDirty();reloadList(kind,1);};parent.append(f);
    }
    function reloadList(kind,page) { if(writeBusy||!guard())return;pages[kind]=Math.max(1,page);remember();const rev=begin();listing(kind,pages[kind],rev).catch(e=>failure(e,()=>reloadList(kind,page),rev)).finally(()=>{if(alive(rev))panel.setAttribute('aria-busy','false');}); }
    function pager(parent,page,more,go) { const nav=el('div',null,'cw-pager');const prev=button(tr('← Назад','← Previous'),()=>go(page-1));prev.disabled=page<=1;const next=button(tr('Далее →','Next →'),()=>go(page+1));next.disabled=!more;nav.append(prev,el('span',tr('Страница ','Page ')+page),next);parent.append(nav); }
    async function listing(kind,page,rev) {
      const endpoint=kind==='participants'?participantMode:'tickets';
      const result=await request(base+'/'+endpoint+'?'+new URLSearchParams({...filters[kind],page}));if(!alive(rev))return;const all=rows(result),list=all.slice(0,25);panel.replaceChildren();
      panel.append(el('h2',kind==='tickets'?tr('Билеты кампании','Campaign tickets'):tr('Участники и чеки','Participants & receipts')));
      if(kind==='participants'){const switcher=el('div',null,'cw-segment');for(const [mode,label]of [['participants',tr('Участники','Participants')],['entries',tr('Заявки и чеки','Entries & receipts')]]){const b=button(label,()=>{participantMode=mode;reloadList(kind,1);},'btn sm');b.setAttribute('aria-pressed',String(participantMode===mode));switcher.append(b);}panel.append(switcher);}
      filterForm(kind,panel);const grid=el('div',null,'cw-list');panel.append(grid);
      panel.insertBefore(button(tr('Обновить список','Refresh list'),()=>reloadList(kind,page)),grid);
      for(const item of list){
        const card=el('article',null,'admin-card cw-row');
        if(kind==='tickets'){
          card.append(el('h3',item.name||'—'),el('p',item.email||''),el('p',item.phone||''),el('p',item.id,'admin-id'),el('p',ticketLabel(item)+' · '+date(item.issued_at)));
          if(item.user_id)card.append(button(tr('Карточка участника','Participant profile'),()=>profile(item.user_id)));
        }else if(participantMode==='participants'){
          card.append(el('h3',item.name||'—'),el('p',item.email||''),el('p',item.phone||''),el('p',item.email_verified_at?tr('Email подтверждён','Email verified'):tr('Email не подтверждён','Email not verified'),'hint'));
          const dl=el('dl',null,'cw-inline-counts');pair(dl,tr('Чеки','Receipts'),String(item.receipts??0));pair(dl,tr('Билеты','Tickets'),String(item.tickets??0));card.append(dl,button(tr('Открыть участника','Open participant'),()=>profile(item.id),'btn sm'));
        }else{
          card.append(el('h3',item.name||'—'),el('p',(item.email||'')+' · '+(item.phone||'')));entry(item,card);
          if(item.user_id)card.append(button(tr('Карточка участника','Participant profile'),()=>profile(item.user_id)));
        }
        grid.append(card);
      }
      if(!list.length)grid.append(el('p',tr('По этим фильтрам ничего не найдено.','Nothing matches these filters.'),'cw-state'));
      pager(panel,page,unpack(result)?.has_more??all.length>25,p=>reloadList(kind,p));panel.setAttribute('aria-busy','false');
    }
    function entry(item,parent) {
      const receipt=item.receipt||{},box=el('div',null,'cw-entry');box.append(el('h4',tr('Заявка ','Entry ')+(item.id||'')),el('p',status(item.status)+' · '+date(item.submitted_at)));
      const dl=el('dl',null,'cw-details');pair(dl,tr('Файл чека','Receipt file'),receipt.name||'—');pair(dl,tr('Проверка','Verification'),status(receipt.verification_status));pair(dl,tr('Распознавание','Recognition'),receipt.recognition_status?status(receipt.recognition_status):tr('Ожидает подключения code-qr.ru','Awaiting code-qr.ru connection'));pair(dl,tr('Подтверждённые товары','Confirmed product quantity'),receipt.matched_quantity==null?tr('Не определено','Unknown'):String(receipt.matched_quantity));box.append(dl);
      if(receipt.id)box.append(button(tr('Открыть чек','Open receipt'),()=>receiptPreview(receipt)));
      const tickets=el('div',null,'cw-ticket-list');tickets.append(el('strong',tr('Билеты этой заявки','Tickets from this entry')));
      for(const t of item.tickets||[]){const row=el('p',t.id,'admin-id');row.append(el('span',' · '+ticketLabel(t)));tickets.append(row);}
      if(!item.tickets?.length)tickets.append(el('p',tr('Билеты ещё не выданы.','No tickets issued yet.'),'hint'));box.append(tickets);
      if(item.status==='pending'&&!campaign.pool_frozen_at){
        const details=el('details',null,'cw-draw-cancel');details.append(el('summary',tr('Подтвердить чек и выдать билеты','Approve receipt and issue tickets')));
        const f=makeForm(details,null,f=>{const v=values(f);if(!confirm(tr('Подтвердить покупку и выдать билетов: ','Approve purchase and issue tickets: ')+v.quantity+'?'))return;write(f.querySelector('[type=submit]'),()=>request(base+'/entries/'+encodeURIComponent(item.id)+'/approve',{method:'POST',json:{quantity:Number(v.quantity),reason:v.reason}}),()=>load());});
        const count=field(f,tr('Количество купленных банок MILANO','Number of MILANO cans purchased'),'quantity','number',1);count.min=1;count.max=1000;count.step=1;
        const reason=field(f,tr('Комментарий проверки','Review comment'),'reason','textarea');reason.minLength=10;reason.maxLength=500;submit(f,tr('Подтвердить и выдать билеты','Approve and issue tickets'));box.append(details);
      }
      if(item.status!=='rejected'&&!campaign.pool_frozen_at){
        const details=el('details',null,'cw-draw-cancel');details.append(el('summary',tr('Отклонить заявку','Reject entry')));
        const f=makeForm(details,null,f=>{const v=values(f);if(!confirm(tr('Отклонить эту заявку и отозвать её билеты? Чек и история сохранятся.','Reject this entry and revoke its tickets? The receipt and history will be retained.')))return;write(f.querySelector('[type=submit]'),()=>request(base+'/entries/'+encodeURIComponent(item.id)+'/reject',{method:'POST',json:{reason:v.reason}}),()=>load());});
        const reason=field(f,tr('Причина отклонения','Rejection reason'),'reason','textarea');reason.minLength=10;reason.maxLength=500;submit(f,tr('Подтвердить отклонение','Confirm rejection'),'btn sm admin-danger-outline');box.append(details);
      }
      parent.append(box);
    }
    async function profile(userId) {
      if(writeBusy||!guard())return;tab='participants';remember();for(const [id,b]of tabButtons){b.classList.toggle('active',id===tab);if(id===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}const rev=begin();try {
        const d=unpack(await request(base+'/participants/'+encodeURIComponent(userId)));if(!alive(rev))return;panel.replaceChildren();
        panel.append(button(tr('← К списку','← Back to list'),()=>reloadList('participants',pages.participants)),el('h2',d.user.name||tr('Участник','Participant')));
        const info=el('section',null,'admin-card'),dl=el('dl',null,'cw-details');pair(dl,'Email',d.user.email);pair(dl,tr('Телефон','Phone'),d.user.phone);pair(dl,tr('Email подтверждён','Email verified'),d.user.email_verified_at?date(d.user.email_verified_at):tr('Нет','No'));pair(dl,tr('Статус','Status'),status(d.user.status));info.append(dl);panel.append(info);
        panel.append(el('h3',tr('Заявки этой кампании','Entries in this campaign')));
        for(const e of d.entries||[]){const card=el('section',null,'admin-card');entry(e,card);panel.append(card);}
        if(!d.entries?.length)panel.append(el('p',tr('Заявок в этой кампании нет.','No entries in this campaign.')));
        if(d.winners?.length){panel.append(el('h3',tr('Выигрыши','Prizes won')));for(const w of d.winners)panel.append(el('p',(w.prize_title||w.title||'')+' · '+status(w.status||'active')+' · '+date(w.assigned_at)));}
        panel.setAttribute('aria-busy','false');
      }catch(e){failure(e,()=>profile(userId),rev);}
    }
    function receiptPreview(receipt) {
      const dialog=el('dialog',null,'cw-receipt-dialog'),close=button(tr('Закрыть','Close'),()=>dialog.close(),'btn sm'),heading=el('h2',receipt.name||tr('Чек','Receipt'));
      const href='/api/v1'+base+'/receipts/'+encodeURIComponent(receipt.id),link=el('a',tr('Открыть в новой вкладке','Open in a new tab'),'btn sm');link.href=href;link.target='_blank';link.rel='noopener noreferrer';
      const download=el('a',tr('Скачать чек','Download receipt'),'btn sm');download.href=href+'?download=1';download.download=receipt.name||'receipt';
      dialog.append(heading,close,link,download,el('p',tr('Если встроенный просмотр недоступен, откройте файл по ссылке. Доступ проверяется сервером.','If the preview is unavailable, open the file using the link. Access is checked by the server.'),'hint'));
      if(String(receipt.mime||'').startsWith('image/')){const image=el('img');image.alt=receipt.name||tr('Чек','Receipt');image.src=href;image.onerror=()=>{image.remove();dialog.append(el('p',tr('Предпросмотр не загрузился. Откройте файл по ссылке или проверьте сессию.','The preview could not load. Open the file using the link or check your session.')));};dialog.append(button(tr('Увеличить / вписать','Zoom / fit'),()=>{image.style.maxWidth=image.style.maxWidth==='none'?'100%':'none';}),image);}else{const frame=el('iframe');frame.title=receipt.name||tr('Чек','Receipt');frame.src=href;dialog.append(frame);}
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.addEventListener('cancel',()=>dialog.close(),{once:true});root.append(dialog);dialog.showModal();
      lifetime.signal.addEventListener('abort',()=>dialog.remove(),{once:true});
    }
    function prizes() {
      panel.replaceChildren();panel.append(el('h2',tr('Призовой фонд','Prize fund')));const list=el('div',null,'cw-prize-grid');panel.append(list);
      for(const p of data.prizes||[]){const card=el('section',null,'admin-card');card.append(el('h3',p.title),el('p',tr('Количество: ','Quantity: ')+p.quantity));if(campaign.status!=='closed'){card.append(button(tr('Редактировать','Edit'),()=>prizeForm(p)),button(tr('Удалить','Delete'),()=>{if(!guard()||!confirm(tr('Удалить этот приз?','Delete this prize?')))return;write(null,()=>request('/admin/campaigns/'+encodeURIComponent(campaignId)+'/prizes/'+encodeURIComponent(p.id),{method:'DELETE'}),()=>load());},'btn sm admin-danger-outline'));}list.append(card);}
      if(!data.prizes?.length)list.append(el('p',tr('Призов пока нет.','No prizes yet.')));if(campaign.status!=='closed')panel.append(button(tr('Добавить приз','Add prize'),()=>prizeForm(),'btn pr sm'));
      const draw=el('section',null,'cw-draw-host');panel.append(draw);
      if(window.MilanoDraw)drawCleanup=window.MilanoDraw.render(draw,{api,lang,campaignId,campaign,prizes:data.prizes||[],onProfile:profile,onBusyChanged:value=>{writeBusy=value;back.disabled=value;refresh.disabled=value;exportButton.disabled=value;for(const b of tabButtons.values())b.disabled=value;},onChanged:async()=>{try{const d=unpack(await api(base,{signal:lifetime.signal}));if(!disposed){data=d;campaign=d.campaign;refreshHeader();}}catch(_){/* The saved result remains available if summary refresh fails. */}}});
      else draw.append(el('p',tr('Модуль выбора победителей недоступен. Обновите страницу.','The draw module is unavailable. Refresh this page.'),'cw-state'));
    }
    function prizeForm(prize=null) {
      if(writeBusy||!guard())return;begin();panel.replaceChildren();panel.setAttribute('aria-busy','false');
      const f=makeForm(panel,prize?tr('Редактировать приз','Edit prize'):tr('Новый приз','New prize'),f=>{const v=values(f);write(f.querySelector('[type=submit]'),()=>request('/admin/campaigns/'+encodeURIComponent(campaignId)+'/prizes'+(prize?'/'+encodeURIComponent(prize.id):''),{method:prize?'PATCH':'POST',json:{title:v.title,quantity:Number(v.quantity)}}),()=>load());});
      const t=field(f,tr('Название приза','Prize title'),'title','text',prize?.title||'');t.minLength=2;t.maxLength=180;const q=field(f,tr('Количество','Quantity'),'quantity','number',prize?.quantity||1);q.min=1;q.max=1000;q.step=1;submit(f,tr('Сохранить','Save'));f.append(button(tr('Отмена','Cancel'),()=>navigate('prizes')));
    }
    function settings() {
      panel.replaceChildren();panel.append(el('h2',tr('Настройки кампании','Campaign settings')));
      if(!campaign.pool_frozen_at){
        const f=makeForm(panel,tr('Название, даты и правила','Title, dates and rules'),f=>{const v=values(f);write(f.querySelector('[type=submit]'),()=>request(base,{method:'PATCH',json:{title:v.title,starts_at:fromMoscow(v.starts_at),ends_at:fromMoscow(v.ends_at),rules_version:v.rules_version,version:campaign.workspace_version}}),()=>load());});
        const t=field(f,tr('Название','Title'),'title','text',campaign.title);t.minLength=3;t.maxLength=180;field(f,tr('Начало — Москва (UTC+3)','Starts — Moscow (UTC+3)'),'starts_at','datetime-local',moscowInput(campaign.starts_at));field(f,tr('Окончание — Москва (UTC+3)','Ends — Moscow (UTC+3)'),'ends_at','datetime-local',moscowInput(campaign.ends_at));field(f,tr('Версия утверждённых правил','Approved rules version'),'rules_version','text',campaign.rules_version||'',false).maxLength=80;f.append(el('p',tr('Часовой пояс устройства не влияет на эти даты. Будущее начало запланирует открытие приёма.','These dates use Moscow time regardless of your device. A future start schedules entries to open.'),'hint'));submit(f,tr('Сохранить настройки','Save settings'));
      }else panel.append(el('p',tr('Список билетов зафиксирован: настройки больше не изменяются.','The ticket pool is frozen: settings can no longer be changed.'),'hint'));
      const actions=el('section',null,'admin-card');actions.append(el('h3',tr('Управление кампанией','Manage campaign')));const buttons=el('div',null,'admin-actions');actions.append(buttons);
      if(campaign.status==='draft')buttons.append(button(tr('Открыть / запланировать','Open / schedule'),()=>{if(!guard()||!confirm(tr('Открыть приём сейчас или автоматически в московское время начала?','Open entries now, or automatically at the Moscow start time?')))return;write(null,()=>request(base+'/activate',{method:'POST',json:{}}),()=>load());},'btn pr sm'));
      if(campaign.status!=='closed')buttons.append(button(tr('Закрыть приём','Close entries'),()=>{if(!guard()||!confirm(tr('Закрыть приём? До фиксации билетов его можно открыть повторно.','Close entries? You can reopen before the ticket pool is frozen.')))return;write(null,()=>request(base+'/close',{method:'POST',json:{}}),()=>load());}));
      if(campaign.status==='closed'&&!campaign.pool_frozen_at){const f=makeForm(panel,tr('Возобновить приём','Reopen entries'),f=>{if(!confirm(tr('Возобновить приём заявок?','Reopen entries?')))return;const v=values(f);write(f.querySelector('[type=submit]'),()=>request(base+'/reopen',{method:'POST',json:v}),()=>load());});field(f,tr('Пароль администратора','Administrator password'),'current_password','password').autocomplete='current-password';submit(f,tr('Открыть приём повторно','Reopen entries'));}
      buttons.append(button(tr('Копировать на следующий квартал','Copy to next quarter'),()=>{if(!guard()||!confirm(tr('Создать черновик следующего квартала с этими призами? Участники, чеки, билеты и результаты не переносятся.','Create a next-quarter draft with these prizes? Participants, receipts, tickets and results are not copied.')))return;write(null,()=>request(base+'/copy',{method:'POST',json:{}}),r=>{const id=unpack(r).id;if(id){cleanup();if(typeof onNavigateCampaign==='function')onNavigateCampaign(id);else render(root,{...options,campaignId:id});}});}));panel.append(actions);
      if(campaign.status!=='open'&&campaign.status!=='scheduled'){
        const danger=el('details',null,'admin-card cw-danger-zone');danger.append(el('summary',tr('Полное удаление кампании','Permanently delete campaign')));panel.append(danger);
        const f=makeForm(danger,null,f=>{if(!confirm(tr('Удалить эту кампанию, заявки, чеки, билеты, призы и результаты? В интерфейсе отмены нет.','Delete this campaign, its entries, receipts, tickets, prizes and results? There is no undo in the interface.')))return;const v=values(f);write(f.querySelector('[type=submit]'),()=>request(base,{method:'DELETE',json:v}),()=>{f.elements.current_password.value='';cleanup();onBack?.();});});
        f.append(el('p',tr('Введите точное название: ','Type the exact title: ')+campaign.title));field(f,tr('Название кампании','Campaign title'),'confirmation').maxLength=180;field(f,tr('Ваш пароль администратора','Administrator password'),'current_password','password').autocomplete='current-password';submit(f,tr('Удалить безвозвратно','Delete permanently'),'btn admin-danger');
      }
    }
    async function audit(page,rev) {
      pages.audit=page;remember();
      const result=await request(base+'/audit?'+new URLSearchParams({page}));if(!alive(rev))return;panel.replaceChildren();panel.append(el('h2',tr('Журнал кампании','Campaign audit')));const all=rows(result);
      const labels={'campaign.update':tr('Настройки изменены','Settings changed'),'campaign.open':tr('Приём открыт','Entries opened'),'campaign.schedule':tr('Приём запланирован','Entries scheduled'),'campaign.close':tr('Приём закрыт','Entries closed'),'campaign.copy':tr('Кампания скопирована','Campaign copied'),'data.export':tr('Данные выгружены','Data exported'),'prize.create':tr('Приз добавлен','Prize added'),'prize.update':tr('Приз изменён','Prize changed'),'prize.delete':tr('Приз удалён','Prize deleted'),'winner.random':tr('Случайный победитель сохранён','Random winner saved'),'winner.manual':tr('Победитель назначен вручную','Winner assigned manually'),'winner.cancel':tr('Назначение отменено','Assignment cancelled')};
      Object.assign(labels,{'campaign.create':tr('Розыгрыш создан','Giveaway created'),'campaign.delete':tr('Розыгрыш удалён','Giveaway deleted'),'campaign.activate':tr('Приём открыт или запланирован','Entries opened or scheduled'),'campaign.reopen':tr('Приём возобновлён','Entries reopened'),'campaign.auto.open':tr('Приём автоматически открыт','Entries automatically opened'),'campaign.auto.closed':tr('Приём автоматически закрыт','Entries automatically closed'),'receipt.approve':tr('Чек подтверждён, билеты выданы','Receipt approved, tickets issued'),'receipt.reject':tr('Чек отклонён','Receipt rejected')});
      for(const a of all.slice(0,25)){const card=el('article',null,'admin-card');card.append(el('h3',labels[a.action]||a.action),el('p',(a.actor||'—')+' · '+date(a.created_at)));if(a.details_json||a.details){const detail=el('details');let text=a.details_json||a.details;try{text=JSON.stringify(typeof text==='string'?JSON.parse(text):text,null,2);}catch(_){text=String(text);}detail.append(el('summary',tr('Подробности','Details')),el('pre',text));card.append(detail);}panel.append(card);}
      if(!all.length)panel.append(el('p',tr('Журнал пока пуст.','The audit log is empty.')));pager(panel,page,unpack(result)?.has_more??all.length>25,p=>{const next=begin();audit(p,next).catch(e=>failure(e,()=>navigate('audit',true),next)).finally(()=>{if(alive(next))panel.setAttribute('aria-busy','false');});});panel.setAttribute('aria-busy','false');
    }
    load();return cleanup;
  }
  return {render};
})();
