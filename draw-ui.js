/* Saved-result reveal: the server chooses and persists every real winner before animation. */
window.MilanoDraw = (() => {
  function render(root, {api,lang='ru',campaignId,campaign,prizes=[],onChanged,onBusyChanged,onProfile}) {
    const tr=(ru,en)=>lang==='en'?en:ru;
    const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;};
    const button=(text,fn,cls='btn sm')=>{const n=el('button',text,cls);n.type='button';n.onclick=fn;return n;};
    const unpack=r=>r?.data??r;
    const rows=r=>{const d=unpack(r);return Array.isArray(d)?d:d?.rows||[];};
    const dirty=f=>{if(typeof MilanoGuard!=='undefined')MilanoGuard.mark(f);};
    const clear=()=>{if(typeof MilanoGuard!=='undefined')MilanoGuard.clear();};
    const date=s=>{if(!s)return'—';const v=String(s).replace(' ','T'),d=new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(v)?v:v+'Z');return Number.isNaN(d.getTime())?'—':d.toLocaleString(lang==='en'?'en-GB':'ru-RU',{timeZone:'Europe/Moscow'})+tr(' МСК',' MSK');};
    const errorText=e=>({close_campaign_first:tr('Сначала закройте приём заявок в настройках.','Close entries in Settings first.'),pending_reviews:tr('Остались непроверенные заявки. Завершите проверку перед фиксацией пула.','Some entries still need review. Complete verification before freezing the pool.'),empty_draw_pool:tr('В пуле нет допустимых билетов.','The pool has no eligible tickets.'),empty_pool:tr('В пуле нет допустимых билетов.','The pool has no eligible tickets.'),no_eligible_tickets:tr('В пуле нет допустимых билетов.','The pool has no eligible tickets.'),invalid_credentials:tr('Неверный пароль администратора.','Incorrect administrator password.'),try_later:tr('Подождите несколько секунд перед повтором.','Wait a few seconds before retrying.'),invalid_prize_slot:tr('Выберите свободное призовое место.','Select an available prize slot.'),prize_slot_taken:tr('Это место уже занято. Обновите результаты.','This slot is already assigned. Refresh the results.'),ineligible_ticket:tr('Выбранный билет не допущен к розыгрышу.','The selected ticket is not eligible.'),ticket_already_won:tr('Этот билет уже выиграл.','This ticket has already won.'),participant_already_won:tr('Участник уже получил приз в этой кампании.','This participant already has a prize in this campaign.'),winner_already_cancelled:tr('Назначение уже отменено. Обновите результаты.','The assignment has already been cancelled. Refresh the results.'),invalid_winner:tr('Проверьте приз, место, билет и причину (10–500 символов).','Check the prize, slot, ticket and reason (10–500 characters).'),invalid_reason:tr('Укажите причину длиной 10–500 символов.','Enter a reason of 10–500 characters.'),idempotency_conflict:tr('Параметры этого запуска отличаются от сохранённого запроса. Обновите результаты.','This draw differs from the saved request. Refresh the results.'),login_required:tr('Сессия завершена. Войдите снова.','Your session expired. Sign in again.'),csrf_failed:tr('Обновите страницу и повторите вход.','Refresh this page and sign in again.'),admin_required:tr('Нужны права администратора.','Administrator access required.')})[e?.message]||tr('Запрос не завершён. Обновите сохранённые результаты перед повтором запуска.','The request did not complete. Refresh saved results before attempting another draw.');
    const base='/admin/draw/'+encodeURIComponent(campaignId),workspace='/admin/workspace/'+encodeURIComponent(campaignId),controller=new AbortController();
    let disposed=false,busy=false,revision=0,searchRevision=0,ticketRevision=0,state=null,timer=null,animationResolve=null,pendingKey=null,pendingPayload=null;
    const alive=rev=>!disposed&&root.isConnected&&(rev==null||rev===revision);
    const request=(path,opts={})=>api(path,{...opts,signal:controller.signal});
    const freshKey=()=>window.crypto?.randomUUID?window.crypto.randomUUID().replaceAll('-',''):Array.from(window.crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
    root.replaceChildren();root.append(el('h2',tr('Выбор победителя','Choose a winner')),el('p',tr('Каждый допустимый билет — равный шанс. Один участник может получить один действующий приз за кампанию.','Every eligible ticket has an equal chance. Each participant can hold one active prize per campaign.'),'hint'));
    const error=el('p',null,'cw-draw-error');error.setAttribute('role','status');error.setAttribute('aria-live','polite');
    const refreshButton=button(tr('Обновить сохранённые результаты','Refresh saved results'),()=>{if(!busy)load();});
    const pool=el('p',tr('Загрузка пула…','Loading the pool…'),'hint'),grid=el('div',null,'cw-draw-grid'),form=el('form',null,'admin-card admin-form cw-form cw-draw-form'),display=el('div'),screen=el('div',null,'cw-draw-screen');
    screen.setAttribute('role','status');screen.setAttribute('aria-live','polite');display.append(screen);
    const results=el('section',null,'cw-draw-winners');grid.append(form,display);root.append(pool,error,refreshButton,grid,results);
    function field(parent,label,name,type='text',value='',required=false){const l=el('label',label),n=el(type==='textarea'?'textarea':'input');if(type!=='textarea')n.type=type;n.name=name;n.value=value;n.required=required;l.append(n);parent.append(l);return n;}
    function select(parent,label,name,choices){const l=el('label',label),n=el('select');n.name=name;for(const [v,text]of choices){const o=el('option',text);o.value=v;n.append(o);}l.append(n);parent.append(l);return n;}
    const prize=select(form,tr('Приз','Prize'),'prize_id',prizes.map(p=>[p.id,p.title+' × '+p.quantity]));prize.required=true;
    const slot=select(form,tr('Призовое место','Prize slot'),'prize_slot',[]);slot.required=true;
    const mode=select(form,tr('Способ выбора','Selection mode'),'mode',[['random',tr('Случайный выбор','Random selection')],['manual',tr('Ручное назначение','Manual assignment')]]);
    const testLabel=el('label',null,'cw-checkbox'),test=el('input');test.type='checkbox';test.name='test';testLabel.append(test,el('span',tr('Тестовая прокрутка — без назначения и изменения пула','Test preview — no assignment or pool changes')));form.append(testLabel);
    const manual=el('div'),searchBox=el('div',null,'cw-draw-search');manual.append(searchBox);
    const search=field(searchBox,tr('Найти участника','Find participant'),'q','search');search.maxLength=160;
    const searchButton=button(tr('Найти','Search'),findParticipants);searchBox.append(searchButton);
    const participant=select(manual,tr('Участник','Participant'),'participant_id',[['',tr('Сначала найдите участника','Find a participant first')]]);
    const ticket=select(manual,tr('Допустимый билет участника','Eligible participant ticket'),'ticket',[['',tr('Выберите участника','Select a participant')]]);form.append(manual);
    const reason=field(form,tr('Причина ручного назначения','Reason for manual assignment'),'reason','textarea');reason.minLength=10;reason.maxLength=500;
    const password=field(form,tr('Ваш пароль администратора','Administrator password'),'password','password');password.autocomplete='current-password';
    const action=el('button',tr('Выбрать и сохранить победителя','Select and save winner'),'btn pr');action.type='submit';
    const notice=el('p',null,'hint');form.append(notice,action);
    const testModeNotice=el('p',tr('ТЕСТ — победитель не назначен','TEST — no winner assigned'),'cw-draw-tag');testModeNotice.hidden=true;display.prepend(testModeNotice);
    const savedNotice=el('p',tr('Результат сначала сохраняется на сервере. Прокрутка только показывает сохранённый выбор; уведомления победителю автоматически не отправляются.','The server saves the result first. The reveal displays that saved selection; winner notifications are not sent automatically.'),'hint');display.append(savedNotice);
    function syncSlots(){
      const p=prizes.find(p=>String(p.id)===prize.value),previous=slot.value;slot.replaceChildren();
      for(let n=1;n<=Number(p?.quantity||0);n++){const used=state?.winners?.some(w=>String(w.prize_id)===String(p.id)&&Number(w.prize_slot)===n&&!['cancelled','canceled'].includes(w.status)),o=el('option',tr('Место ','Slot ')+n+(used?tr(' — занято',' — assigned'):''));o.value=n;o.disabled=Boolean(used)&&!test.checked;slot.append(o);}
      if([...slot.options].some(o=>o.value===previous&&!o.disabled))slot.value=previous;else slot.value=[...slot.options].find(o=>!o.disabled)?.value||'';
      syncMode();
    }
    function syncMode(){
      const isTest=test.checked,isManual=mode.value==='manual'&&!isTest;
      manual.hidden=!isManual;reason.closest('label').hidden=!isManual;password.closest('label').hidden=!isManual;
      participant.required=isManual;ticket.required=isManual;reason.required=isManual;password.required=isManual;mode.disabled=busy||isTest;
      action.textContent=isTest?tr('Запустить ТЕСТ','Run TEST'):isManual?tr('Назначить и сохранить','Assign and save'):tr('Выбрать и сохранить победителя','Select and save winner');
      notice.textContent=isTest?tr('ТЕСТ: результат не становится победителем, призовое место и билеты не расходуются.','TEST: the result is not a winner; prize slots and tickets are not consumed.'):isManual?tr('Ручной выбор записывается в журнал вместе с причиной.','Manual selection is recorded in the audit log with its reason.'):tr('Победитель выбирается сервером случайно из допустимых билетов.','The server randomly selects a winner from eligible tickets.');
      testModeNotice.hidden=!isTest;
      action.disabled=busy||(!isTest&&(campaign.status!=='closed'||!state?.eligible_count||(!state?.frozen_at&&state?.pending_count>0)))||!prize.value||!slot.value||!state;
      if(isTest)screen.dataset.test='true';else delete screen.dataset.test;
    }
    function setBusy(value){busy=value;onBusyChanged?.(value);const controls=root.querySelectorAll('input,select,textarea,button');controls.forEach(n=>n.disabled=value);if(!value){syncSlots();searchButton.disabled=false;refreshButton.disabled=false;}}
    prize.onchange=syncSlots;mode.onchange=syncMode;test.onchange=syncSlots;participant.onchange=loadTickets;
    form.addEventListener('input',()=>dirty(form),{signal:controller.signal});form.addEventListener('change',()=>dirty(form),{signal:controller.signal});
    // Enter in participant search performs a search rather than starting a draw.
    search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findParticipants();}},{signal:controller.signal});
    async function findParticipants(){
      if(busy)return;const rev=++searchRevision;++ticketRevision;searchButton.disabled=true;error.textContent='';
      try{const list=rows(await request(workspace+'/participants?'+new URLSearchParams({q:search.value,page:1})));if(!alive()||rev!==searchRevision)return;participant.replaceChildren();const none=el('option',list.length?tr('Выберите участника','Select a participant'):tr('Участники не найдены','No participants found'));none.value='';participant.append(none);
        for(const p of list.slice(0,25)){const o=el('option',(p.name||'—')+' · '+(p.email||'')+' · '+(p.phone||''));o.value=p.id;participant.append(o);}if(list.length>25)error.textContent=tr('Показаны первые 25 совпадений. Уточните имя, email, телефон или номер билета.','Showing the first 25 matches. Refine name, email, phone or ticket ID.');ticket.replaceChildren();const placeholder=el('option',tr('Выберите участника','Select a participant'));placeholder.value='';ticket.append(placeholder);
      }catch(e){if(alive()&&rev===searchRevision&&e.name!=='AbortError')error.textContent=errorText(e);}finally{if(alive()&&rev===searchRevision)searchButton.disabled=false;}
    }
    async function loadTickets(){
      const rev=++ticketRevision,id=participant.value;ticket.replaceChildren();const waiting=el('option',id?tr('Загрузка билетов…','Loading tickets…'):tr('Выберите участника','Select a participant'));waiting.value='';ticket.append(waiting);ticket.disabled=true;if(!id){ticket.disabled=false;return;}
      try{const profile=unpack(await request(workspace+'/participants/'+encodeURIComponent(id)));if(!alive()||rev!==ticketRevision)return;ticket.replaceChildren();const eligible=(profile.entries||[]).flatMap(e=>e.tickets||[]).filter(t=>t.draw_eligible===true);
        if(!eligible.length){const o=el('option',tr('Нет допустимых билетов','No eligible tickets'));o.value='';ticket.append(o);}else for(const t of eligible){const o=el('option',(t.ordinal?tr('Билет №','Ticket #')+t.ordinal+' · ':'')+t.id);o.value=t.id;ticket.append(o);}
      }catch(e){if(alive()&&rev===ticketRevision&&e.name!=='AbortError'){error.textContent=errorText(e);ticket.replaceChildren();const o=el('option',tr('Не удалось загрузить билеты','Tickets could not load'));o.value='';ticket.append(o);}}finally{if(alive()&&rev===ticketRevision)ticket.disabled=false;}
    }
    function showResult(result,isTest=false,restored=false){
      screen.replaceChildren();screen.classList.remove('is-revealing');
      if(isTest)screen.append(el('span','TEST','cw-test-mark'));
      screen.append(el('div',isTest?tr('ДЕМОНСТРАЦИЯ • без назначения','DEMO • no assignment'):!result?tr('Результатов пока нет','No results yet'):restored?tr('Сохранённый результат','Saved result'):tr('Победитель сохранён','Winner saved'),'cw-draw-result-label'));
      if(!result){screen.append(el('p',tr('Победитель ещё не выбран','No winner selected yet')));return;}
      screen.append(el('div',result.name||result.name_masked||'—','cw-draw-name'),el('div',result.ticket||'—','admin-id'),el('p',(result.prize_title||'')+' · '+tr('Место ','Slot ')+result.prize_slot));
      if(!isTest){if(result.phone)screen.append(el('p',result.phone));if(result.email)screen.append(el('p',result.email));if(result.user_id&&onProfile)screen.append(button(tr('Открыть участника','Open participant'),()=>onProfile(result.user_id)));}
      if(!isTest&&result.mode)screen.append(el('span',result.mode==='manual'?tr('Ручное назначение','Manual assignment'):tr('Случайный выбор','Random selection'),'cw-draw-tag'));
      if(result.assigned_at)screen.append(el('p',date(result.assigned_at),'hint'));
      if(result.status==='cancelled'||result.status==='canceled')screen.append(el('p',tr('Назначение отменено','Assignment cancelled'),'cw-draw-tag cancelled'));
    }
    function animateResult(result,isTest){
      if(!alive())return Promise.resolve();
      if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){showResult(result,isTest);return Promise.resolve();}
      screen.replaceChildren();screen.classList.add('is-revealing');screen.setAttribute('aria-live','off');
      if(isTest)screen.append(el('span','TEST','cw-test-mark'));
      screen.append(el('div',isTest?tr('ТЕСТ • без назначения','TEST • no assignment'):tr('Результат сохранён','Result saved'),'cw-draw-result-label'),el('div',tr('Открываем результат…','Revealing the result…'),'cw-draw-name'),el('p',tr('Выбор уже выполнен сервером','The server has completed the selection'),'hint'));
      const progress=el('div',null,'cw-draw-progress');progress.setAttribute('aria-hidden','true');progress.append(el('span'));screen.append(progress);
      const viewport=el('div',null,'cw-roulette-window'),track=el('div',null,'cw-roulette-track');viewport.setAttribute('aria-hidden','true');
      const sample=isTest?Array.from({length:12},(_,i)=>({name:'DEMO '+(i+1),ticket:'DEMO-'+(i+1)})):(state?.candidates||[]);
      const candidates=sample.length?sample:[result];
      for(let i=0;i<44;i++){const c=i===43?result:candidates[i%candidates.length];const row=el('div',null,'cw-roulette-item');row.append(el('strong',c.name||c.name_masked||'—'),el('small',c.ticket||''));track.append(row);}
      viewport.append(track);screen.append(viewport);requestAnimationFrame(()=>{if(alive())track.style.transform='translateY(-'+(43*80)+'px)';});
      return new Promise(resolve=>{animationResolve=resolve;timer=setTimeout(()=>{timer=null;animationResolve=null;if(alive()){screen.setAttribute('aria-live','polite');showResult(result,isTest);}resolve();},7000);});
    }
    function winnerList(){
      results.replaceChildren();results.append(el('h3',tr('Сохранённые назначения','Saved assignments')));
      const winners=state?.winners||[];if(!winners.length){results.append(el('p',tr('Победители ещё не назначены.','No winners assigned yet.'),'hint'));return;}
      for(const w of winners){const cancelled=['cancelled','canceled'].includes(w.status),card=el('article',null,'admin-card');card.append(el('h4',w.name||w.name_masked||'—'),el('p',(w.prize_title||'')+' · '+tr('Место ','Slot ')+w.prize_slot),el('p',w.ticket,'admin-id'),el('span',cancelled?tr('Отменено','Cancelled'):w.mode==='manual'?tr('Ручное назначение','Manual assignment'):tr('Случайный выбор','Random selection'),'cw-draw-tag'+(cancelled?' cancelled':'')),el('p',date(w.assigned_at),'hint'));
        if(w.phone)card.append(el('p',w.phone));if(w.email)card.append(el('p',w.email));if(w.user_id&&onProfile)card.append(button(tr('Открыть участника','Open participant'),()=>onProfile(w.user_id)));
        if(w.reason)card.append(el('p',tr('Причина: ','Reason: ')+w.reason));
        if(w.cancellation_reason||w.cancel_reason)card.append(el('p',tr('Причина отмены: ','Cancellation reason: ')+(w.cancellation_reason||w.cancel_reason)));
        if(!cancelled){const details=el('details',null,'cw-draw-cancel');details.append(el('summary',tr('Отменить назначение','Cancel assignment')));const f=el('form',null,'admin-form');const reason=field(f,tr('Причина отмены','Cancellation reason'),'reason','textarea','',true);reason.minLength=10;reason.maxLength=500;const pw=field(f,tr('Ваш пароль администратора','Administrator password'),'password','password','',true);pw.autocomplete='current-password';const label=el('label',null,'cw-checkbox'),back=el('input');back.type='checkbox';back.name='return_to_pool';label.append(back,el('span',tr('Вернуть билеты участника в пул','Return participant tickets to the pool')));f.append(label);const b=el('button',tr('Подтвердить отмену','Confirm cancellation'),'btn admin-danger-outline');b.type='submit';f.append(b);f.addEventListener('input',()=>dirty(f),{signal:controller.signal});f.addEventListener('change',()=>dirty(f),{signal:controller.signal});
          f.onsubmit=async e=>{e.preventDefault();if(busy||!f.reportValidity()||!confirm(tr('Отменить это назначение? История сохранится.','Cancel this assignment? Its history will be retained.')))return;setBusy(true);error.textContent='';const rev=revision;try{await request(base+'/cancel/'+encodeURIComponent(w.id),{method:'POST',json:{reason:reason.value,password:pw.value,return_to_pool:back.checked}});pw.value='';clear();if(alive(rev)){await load(false);await onChanged?.();}}catch(e){if(alive(rev)&&e.name!=='AbortError')error.textContent=errorText(e);}finally{pw.value='';if(alive())setBusy(false);}};details.append(f);card.append(details);}
        results.append(card);
      }
    }
    async function load(clearError=true){
      const rev=++revision;if(clearError)error.textContent='';refreshButton.disabled=true;pool.textContent=tr('Загрузка сохранённых результатов…','Loading saved results…');
      try{const loaded=unpack(await request(base+'/state'));if(!alive(rev))return;state=loaded;pool.textContent=tr('Допустимых билетов: ','Eligible tickets: ')+(state.eligible_count??0)+' · '+tr('Ожидают проверки: ','Pending reviews: ')+(state.pending_count??0)+' · '+tr('Всего в пуле: ','Total pool: ')+(state.pool_count??0)+(state.frozen_at?' · '+tr('Зафиксирован: ','Frozen: ')+date(state.frozen_at):' · '+tr('Пул ещё не зафиксирован','Pool not frozen yet'));winnerList();syncSlots();showResult(state.last_result,false,true);if(campaign.status!=='closed')error.textContent=tr('Реальный выбор доступен после закрытия приёма. Тест можно запустить сейчас.','Close entries before a real selection. Demo is available now.');else if(state.pending_count&&!state.frozen_at)error.textContent=tr('Сначала завершите проверку чеков. Демонстрация доступна.','Complete receipt moderation first. Demo is available.');else if(!state.eligible_count)error.textContent=tr('Допустимых билетов нет. Доступна только демонстрация.','No eligible tickets. Demo is available.');}
      catch(e){if(alive(rev)&&e.name!=='AbortError'){error.textContent=errorText(e);pool.textContent=tr('Не удалось загрузить пул.','Could not load the pool.');}}
      finally{if(alive(rev)){refreshButton.disabled=false;syncMode();}}
    }
    form.onsubmit=async e=>{
      e.preventDefault();if(busy||!state||!form.reportValidity()||(!test.checked&&campaign.status!=='closed'))return;
      const isTest=test.checked,isManual=mode.value==='manual';
      if(!isTest&&!confirm(isManual?tr('Назначить выбранному участнику этот приз и сохранить результат?','Assign this prize to the selected participant and save the result?'):tr('Выбрать одного случайного победителя и сохранить результат?','Select one random winner and save the result?')))return;
      const payload={prize_id:Number(prize.value),prize_slot:Number(slot.value)};
      if(isTest)payload.demo=true;
      if(!isTest)Object.assign(payload,{mode:mode.value,...(isManual?{ticket:ticket.value,reason:reason.value,password:password.value}:{})});
      const identity=JSON.stringify({...payload,password:undefined});
      if(!isTest&&pendingPayload!==identity){pendingPayload=identity;pendingKey=freshKey();}
      setBusy(true);error.textContent='';const rev=revision;
      try{
        const result=unpack(await request(base+(isTest?'/preview':'/run'),{method:'POST',json:payload,...(!isTest?{headers:{'Idempotency-Key':pendingKey}}:{})}));
        password.value='';if(!alive(rev))return;clear();if(!isTest){pendingKey=null;pendingPayload=null;}
        await animateResult(result.result,isTest);if(!alive(rev))return;
        if(!isTest){const saved=result.result;await load(false);if(alive())showResult(saved,false);await onChanged?.();}
      }catch(e){if(alive(rev)&&e.name!=='AbortError')error.textContent=errorText(e);}
      finally{password.value='';if(alive())setBusy(false);}
    };
    function cleanup(){if(disposed)return;disposed=true;++revision;++searchRevision;++ticketRevision;controller.abort();if(timer)clearTimeout(timer);timer=null;animationResolve?.();animationResolve=null;password.value='';onBusyChanged?.(false);}
    syncSlots();load();return cleanup;
  }
  return {render};
})();
