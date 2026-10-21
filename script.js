const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)],
  A = $('#A');
const IMG = {
    mango: 'assets/mango.png',
    classic: 'assets/classic.png',
    pomegranate: 'assets/pomegranate.jpg',
    berries: 'assets/berries.jpg',
    blood: 'assets/blood-orange.jpg',
    game: 'assets/game.webp',
    sport: 'assets/sport.webp',
    risk: 'assets/risk.webp',
  },
  HALAL = 'assets/halal.webp',
  AH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
const HC = {
  mango: 'assets/can-mango.webp',
  classic: 'assets/can-classic.webp',
  pomegranate: 'assets/can-pomegranate.webp',
  berries: 'assets/can-berries.webp',
  blood: 'assets/can-blood.webp',
};
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const sha = async (s) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const gs = (k) => {
    try {
      return localStorage.getItem(k);
    } catch (e) {}
  },
  ss = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  };
let lang = gs('ml') === 'en' ? 'en' : 'ru';
let SITE_COPY = {};
const t = (key) =>
  SITE_COPY[key + '_' + lang]
    ? esc(SITE_COPY[key + '_' + lang])
    : window.MILANO_COPY[lang][key];
const L = (o, k) =>
    lang === 'en'
      ? o[k + '_en'] ||
        window.MILANO_ARTICLES?.[o.id]?.[k] ||
        trs(String(o[k] || ''))
      : o[k],
  loc = () => (lang == 'en' ? 'en-US' : 'ru-RU');
const EM = {
  mango: '🥭',
  classic: '⚡',
  pomegranate: '🍒',
  berries: '🫐',
  blood: '🍊',
};
let D = { products: [], posts: [], partners: [], promo: { end: 0, title: '' } };
let SERVER_USER = null,
  SERVER_ENTRIES = [],
  SERVER_CAMPAIGN = null,
  CSRF = '';
let SERVER_TICKET_COUNTS = null,
  SERVER_TICKETS_READY = false,
  SERVER_TICKETS_ERROR = false;
const me = () => SERVER_USER;
const transport = MilanoRuntime.createClient({
  fetchImpl: (...args) => fetch(...args),
});
const api = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) },
    init = { ...options, headers };
  if (options.method && options.method !== 'GET')
    headers['X-CSRF-Token'] = CSRF;
  if (options.json) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.json);
    delete init.json;
  }
  if (options.body instanceof FormData) init.timeoutMs = 60000;
  try {
    const result = await transport.request('/api/v1' + path, init);
    if (path === '/me/entries')
      rememberTickets(result.data, result.meta?.ticket_counts);
    if (path === '/me/account')
      rememberTickets(result.data.entries, result.data.ticket_counts);
    return result;
  } catch (error) {
    if (path === '/me/entries') {
      SERVER_TICKETS_ERROR = true;
      updatePromoAccount();
    }
    if (error.message === 'login_required') {
      SERVER_USER = null;
      SERVER_ENTRIES = [];
      userUI();
      try {
        const s = await transport.request('/api/v1/session');
        CSRF = s.data.csrf;
      } catch {}
    }
    throw error;
  }
};

function rememberTickets(items, counts) {
  SERVER_ENTRIES = Array.isArray(items) ? items : [];
  SERVER_TICKET_COUNTS = counts && typeof counts === 'object' ? counts : null;
  SERVER_TICKETS_READY = true;
  SERVER_TICKETS_ERROR = false;
  updatePromoAccount();
}
function updatePromoAccount() {
  const line = $('#pu'),
    box = $('#pb');
  if (!line || !box) return;
  const u = me();
  if (!u)
    line.textContent =
      lang === 'en'
        ? 'Sign in to enter giveaways.'
        : 'Войдите, чтобы участвовать в розыгрышах.';
  else if (SERVER_TICKETS_ERROR)
    line.textContent =
      u.name +
      (lang === 'en'
        ? ', ticket information is temporarily unavailable.'
        : ', данные о билетах временно недоступны.');
  else if (!SERVER_TICKETS_READY)
    line.textContent =
      u.name + (lang === 'en' ? ', loading tickets…' : ', загружаем билеты…');
  else {
    const ids = new Set();
    for (const row of SERVER_ENTRIES) {
      if (row.campaign_id && row.campaign_id !== SERVER_CAMPAIGN?.id) continue;
      for (const ticket of Array.isArray(row.tickets)
        ? row.tickets
        : row.ticket_id
          ? [{ id: row.ticket_id }]
          : [])
        if (ticket.id) ids.add(ticket.id);
    }
    const n = SERVER_TICKET_COUNTS
      ? Number(SERVER_TICKET_COUNTS[SERVER_CAMPAIGN?.id] || 0)
      : ids.size;
    const word =
      n % 100 >= 11 && n % 100 <= 14
        ? 'билетов'
        : n % 10 === 1
          ? 'билет'
          : n % 10 >= 2 && n % 10 <= 4
            ? 'билета'
            : 'билетов';
    line.textContent =
      lang === 'en'
        ? `${u.name}, you have ${n} ticket${n === 1 ? '' : 's'}`
        : `${u.name}, у вас ${n} ${word}`;
  }
  box.replaceChildren();
  if (!u) {
    const b = document.createElement('button');
    b.className = 'btn pr full';
    b.id = 'pl';
    b.textContent =
      lang === 'en' ? 'Sign in or register' : 'Войти или зарегистрироваться';
    b.onclick = () => authBox('in', updatePromoAccount);
    box.append(b);
  }
}
const apiMessage = (code) =>
  ({
    request_timeout:
      lang === 'en'
        ? 'The request took too long. Check your connection and retry.'
        : 'Сервер не ответил вовремя. Проверьте соединение и повторите.',
    network_error:
      lang === 'en'
        ? 'No connection to the server. Please retry.'
        : 'Нет соединения с сервером. Повторите попытку.',
    invalid_response:
      lang === 'en'
        ? 'Invalid server response. Please retry.'
        : 'Не удалось прочитать ответ сервера. Повторите попытку.',
    request_cancelled: lang === 'en' ? 'Request cancelled.' : 'Запрос отменён.',
    cms_validation:
      lang === 'en'
        ? 'Check the contact fields'
        : 'Проверьте контактные данные',
    partner_rate_limited:
      lang === 'en'
        ? 'Too many requests. Try again in an hour.'
        : 'Слишком много заявок. Повторите через час.',
    consent_required:
      lang === 'en' ? 'Consent is required' : 'Подтвердите согласие',
    login_rate_limited:
      lang === 'en'
        ? 'Too many login attempts. Try again in 15 minutes.'
        : 'Слишком много попыток входа. Повторите через 15 минут.',
    csrf_failed:
      lang === 'en'
        ? 'Refresh the page and try again.'
        : 'Обновите страницу и повторите попытку.',
    email_taken:
      lang === 'en'
        ? 'This email is already registered'
        : 'Этот email уже зарегистрирован',
    invalid_credentials:
      lang === 'en' ? 'Wrong email or password' : 'Неверный email или пароль',
    validation_failed:
      lang === 'en' ? 'Check the form fields' : 'Проверьте поля формы',
    campaign_unavailable:
      lang === 'en' ? 'No active giveaway yet' : 'Активного розыгрыша пока нет',
    campaign_period_exists:
      lang === 'en'
        ? 'A campaign already exists for this quarter'
        : 'Кампания этого квартала уже существует',
    invalid_campaign:
      lang === 'en'
        ? 'Check campaign dates, rules and status'
        : 'Проверьте даты, правила и статус кампании',
    receipt_too_large: lang === 'en' ? 'File exceeds 8 MB' : 'Файл больше 8 МБ',
    unsupported_receipt:
      lang === 'en'
        ? 'Use JPG, PNG, WebP or PDF'
        : 'Нужен JPG, PNG, WebP или PDF',
    unsupported_upload:
      lang === 'en'
        ? 'Use JPG, PNG, WebP or PDF. HEIC is not supported; export the photo as JPG.'
        : 'Нужен JPG, PNG, WebP или PDF. HEIC не поддерживается — сохраните фото как JPG.',
    upload_too_large:
      lang === 'en'
        ? 'The file exceeds 8 MB. Reduce its size and try again.'
        : 'Файл больше 8 МБ. Уменьшите его и отправьте снова.',
    upload_required:
      lang === 'en'
        ? 'Choose a receipt file again.'
        : 'Выберите файл чека заново.',
    invalid_upload:
      lang === 'en'
        ? 'The file could not be uploaded. Choose it again.'
        : 'Не удалось загрузить файл. Выберите его заново.',
    invalid_image:
      lang === 'en'
        ? 'The image is damaged. Upload another photo.'
        : 'Изображение повреждено. Загрузите другое фото.',
    invalid_image_dimensions:
      lang === 'en'
        ? 'Image is too large or unreadable. Resize it to at most 6000 pixels per side and 16 megapixels.'
        : 'Изображение слишком большое или не читается. Уменьшите до 6000 пикселей по стороне и 16 мегапикселей.',
    unsafe_pdf:
      lang === 'en'
        ? 'This PDF is unsafe or damaged. Use a photo or another PDF.'
        : 'PDF повреждён или содержит недопустимые элементы. Загрузите фото или другой PDF.',
    storage_capacity_reached:
      lang === 'en'
        ? 'Receipt storage is temporarily unavailable. Please try later.'
        : 'Хранилище чеков временно недоступно. Повторите позже.',
    upload_rate_limited:
      lang === 'en'
        ? 'Too many uploads. Wait before trying again.'
        : 'Слишком много загрузок. Подождите перед повторной отправкой.',
    duplicate_receipt:
      lang === 'en'
        ? 'This file has already been submitted to this giveaway. Check your account or upload a different receipt.'
        : 'Этот файл уже отправлен на данный розыгрыш. Проверьте личный кабинет или загрузите другой чек.',
    legal_not_published:
      lang === 'en'
        ? 'Giveaway documents are not approved yet. Entries are unavailable.'
        : 'Документы розыгрыша ещё не утверждены. Приём заявок недоступен.',
    legal_updated:
      lang === 'en'
        ? 'Documents changed. Reload the page and read them again.'
        : 'Документы обновились. Обновите страницу и ознакомьтесь с ними.',
    idempotency_conflict:
      lang === 'en'
        ? 'This request key was used for another receipt'
        : 'Этот ключ уже использован для другого чека',
    service_unavailable:
      lang === 'en' ? 'Server is unavailable' : 'Сервер недоступен',
  })[code] || code;
let CAMPAIGN_ERROR = '',
  CAMPAIGN_READY = false;
const refreshCampaign = async () => {
  CAMPAIGN_ERROR = '';
  try {
    SERVER_CAMPAIGN = (await api('/campaign/display')).data;
    D.promo.end = SERVER_CAMPAIGN
      ? Date.parse(SERVER_CAMPAIGN.ends_at.replace(' ', 'T') + 'Z')
      : 0;
    if (SERVER_CAMPAIGN) D.promo.title = SERVER_CAMPAIGN.title;
  } catch (error) {
    CAMPAIGN_ERROR = error.message;
    throw error;
  } finally {
    CAMPAIGN_READY = true;
  }
};
let serverRefresh = null,
  CONTENT_ERROR = '',
  pendingSection = null;
const refreshServer = () => {
  if (serverRefresh) return serverRefresh;
  serverRefresh = (async () => {
    CONTENT_ERROR = '';
    const content = refreshContent()
      .then(() => {
        A.dataset.v = '';
        route({ navigate: pendingSection !== null });
        document.documentElement.removeAttribute('data-content-state');
      })
      .catch((error) => {
        CONTENT_ERROR = error.message;
        if (!CONTENT_READY) {
          A.dataset.v = '';
          route();
        } else toast(apiMessage(error.message));
      });
    const session = api('/session')
      .then(async (s) => {
        CSRF = s.data.csrf;
        SERVER_USER = s.data.user;
        TEST_MAIL = s.data.test_mail;
        LOCAL_LEGAL_DRAFTS = s.data.local_legal_drafts === true;
        userUI();
        if (SERVER_USER)
          try {
            SERVER_ENTRIES = (await api('/me/entries')).data;
          } catch (error) {
            console.warn('MILANO entries:', error.message);
          }
      })
      .catch((error) => console.warn('MILANO session:', error.message));
    const legal = api('/legal/current')
      .then((r) => (LEGAL_DOCS = r.data))
      .catch((error) => console.warn('MILANO legal:', error.message));
    const campaign = refreshCampaign().catch((error) =>
      console.warn('MILANO campaign:', error.message),
    );
    await Promise.allSettled([content, session, legal, campaign]);
    userUI();
    window.updateHeroCampaign?.();
    if (location.hash.startsWith('#/admin') && !$('#ap')) route();
  })().finally(() => {
    serverRefresh = null;
    const retry = $('#content-retry');
    if (retry && CONTENT_ERROR) retry.disabled = false;
  });
  return serverRefresh;
};
const adminApi = async (path, options = {}) => {
  const result = await api(path, options);
  if (options.method && options.method !== 'GET') await refreshCampaign();
  return result;
};
let CONTENT_READY = false;
const renderContacts = () => {
  const contacts = document.querySelector('.site-contacts');
  if (!contacts) return;
  contacts.replaceChildren();
  const s = D.settings,
    phones = String(s.contact_phone || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  const paths = {
    phone:
      'M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2Z',
    email: 'M3 5h18v14H3ZM3 5l9 7 9-7',
    pin: 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  };
  const group = (name, title) => {
    const g = document.createElement('div');
    g.className = name;
    const h = document.createElement('h2');
    h.className = 'footer-contact-title';
    h.textContent = title;
    g.append(h);
    contacts.append(g);
    return g;
  };
  const item = (parent, value, href, icon) => {
    const n = document.createElement(href ? 'a' : 'span');
    n.className = 'footer-contact-item';
    if (href) n.href = href;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(svg.namespaceURI, 'path');
    p.setAttribute('d', paths[icon]);
    svg.append(p);
    const text = document.createElement('span');
    text.textContent = value;
    n.append(svg, text);
    parent.append(n);
  };
  if (phones.length || s.contact_email) {
    const g = group(
      'footer-reach',
      lang === 'en' ? 'Get in touch' : 'Связаться с нами',
    );
    phones.forEach((phone) =>
      item(g, phone, 'tel:' + phone.replace(/[ ()-]/g, ''), 'phone'),
    );
    if (s.contact_email)
      item(g, s.contact_email, 'mailto:' + s.contact_email, 'email');
  }
  const address = lang === 'en' ? s.address_en : s.address_ru;
  if (address)
    item(
      group('footer-location', lang === 'en' ? 'Our office' : 'Наш офис'),
      address,
      null,
      'pin',
    );
};
const refreshContent = async () => {
  const r = await api('/content');
  D.products = r.data.products;
  D.posts = r.data.posts;
  D.settings = r.data.settings;
  SITE_COPY = r.data.settings;
  CONTENT_READY = true;
  renderContacts();
};
function previewArticle(p) {
  const title = lang === 'en' ? p.title_en || p.title : p.title,
    body = lang === 'en' ? p.body_en || p.body : p.body;
  const o = modal(
    `<h3>${esc(title)}</h3><div class="pb cms-preview">${md(body || '')}${(p.imgs || []).map((src) => `<img src="${esc(src)}" alt="">`).join('')}</div>`,
  );
  o.setAttribute('translate', 'no');
}
function previewContent(p, type = 'articles') {
  const o = modal(
    '<div class="admin-actions"></div><div class="cms-preview"></div>',
  );
  o.setAttribute('translate', 'no');
  let locale = lang;
  const nav = $('.admin-actions', o),
    body = $('.cms-preview', o);
  const image = (src) => {
    if (!src) return;
    try {
      const url = new URL(src, location.href);
      if (
        url.origin !== location.origin ||
        !['http:', 'https:'].includes(url.protocol)
      )
        return;
      const n = document.createElement('img');
      n.src = url.href;
      n.alt = '';
      n.className = 'cms-thumb';
      body.append(n);
    } catch {}
  };
  const draw = () => {
    body.replaceChildren();
    const suffix = locale === 'en' ? '_en' : '',
      text = (tag, value) => {
        const n = document.createElement(tag);
        n.textContent = value || '';
        body.append(n);
      };
    text(
      'p',
      locale === 'en'
        ? 'Preview — not published'
        : 'Предпросмотр — не опубликовано',
    );
    image(p.img);
    if (type === 'products') {
      text('h2', p['name' + suffix]);
      text('p', p['taste' + suffix]);
      text('p', p['note' + suffix]);
      for (const metric of p[suffix ? 'st_en' : 'st'] || [])
        text('p', metric.join(' · '));
      text('p', '18+');
    } else {
      text('h2', p['title' + suffix]);
      text('p', p['tag' + suffix]);
      text('p', p['excerpt' + suffix]);
      const content = document.createElement('div');
      content.className = 'pb';
      content.innerHTML = md(p['body' + suffix] || '');
      body.append(content);
      for (const src of p.imgs || []) image(src);
    }
  };
  for (const value of ['ru', 'en']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm';
    b.textContent = value.toUpperCase();
    b.onclick = () => {
      locale = value;
      draw();
    };
    nav.append(b);
  }
  draw();
}
const toast = (m) => {
  const t = document.createElement('div');
  t.className = 'ts';
  t.textContent = m;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
};
const img = (p) => p.img || IMG[p.code] || IMG.classic,
  pimg = (s) => (s && s[0] == '@' ? IMG[s.slice(1)] : s);
const shrink = (f, max = 900, q = 0.82) =>
  new Promise((r) => {
    if (!f.type.startsWith('image/')) return r(null);
    const i = new Image();
    i.onload = () => {
      const k = Math.min(1, max / Math.max(i.width, i.height)),
        c = document.createElement('canvas');
      c.width = i.width * k;
      c.height = i.height * k;
      c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
      r(c.toDataURL(/png|webp/.test(f.type) ? 'image/webp' : 'image/jpeg', q));
    };
    i.onerror = () => r(null);
    i.src = URL.createObjectURL(f);
  });
function modal(h) {
  const previous = document.activeElement,
    o = document.createElement('div');
  o.className = 'ov';
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  o.innerHTML = `<div class="md">${h}<button class="modal-close" type="button" aria-label="${t('close')}">✕</button></div>`;
  const close = () => o.remove();
  const k = (e) => {
    if ([...document.querySelectorAll('.ov')].at(-1) !== o) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'Tab') {
      const els = [
        ...o.querySelectorAll(
          'a[href],button,input,select,textarea,[tabindex="0"]',
        ),
      ].filter((x) => !x.disabled && x.getClientRects().length);
      const first = els[0],
        last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  document.addEventListener('keydown', k);
  const cleanup = new MutationObserver(() => {
    if (!o.isConnected) {
      document.removeEventListener('keydown', k);
      cleanup.disconnect();
      document.body.style.overflow = document.querySelector('.ov')
        ? 'hidden'
        : '';
      previous?.isConnected && previous.focus();
    }
  });
  cleanup.observe(document.body, { childList: true });
  o.onclick = (e) => {
    if (e.target === o || e.target.closest('.modal-close')) close();
  };
  document.body.append(o);
  document.body.style.overflow = 'hidden';
  walk(o);
  o.setAttribute(
    'aria-label',
    o.querySelector('h3')?.textContent || t('account'),
  );
  requestAnimationFrame(() => (o.querySelector('input,button') || o).focus());
  return o;
}
/* auth */
let TEST_MAIL = false,
  LOCAL_LEGAL_DRAFTS = false,
  LEGAL_DOCS = [];
function accountContext() {
  return {
    api,
    lang,
    modal,
    home: () => {
      history.replaceState(null, '', '#top');
      route({ navigate: true });
      scrollTo({ top: 0, behavior: 'instant' });
    },
    testMail: TEST_MAIL,
    legalDraft: LOCAL_LEGAL_DRAFTS,
    user: () => SERVER_USER,
    legal: async () =>
      LEGAL_DOCS.length
        ? LEGAL_DOCS
        : (LEGAL_DOCS = (await api('/legal/current')).data),
    setUser: (u, csrf) => {
      const changed = u && u.id !== SERVER_USER?.id;
      SERVER_USER = u;
      if (csrf) CSRF = csrf;
      if (!u) SERVER_ENTRIES = [];
      if (changed) {
        SERVER_TICKETS_READY = false;
        SERVER_TICKETS_ERROR = false;
        SERVER_TICKET_COUNTS = null;
        SERVER_ENTRIES = [];
        api('/me/entries').catch(() => {});
      }
      userUI();
    },
    setEntries: (items) => {
      SERVER_ENTRIES = items;
      updatePromoAccount();
    },
    repaint: () => {
      if (location.hash.startsWith('#/admin')) {
        A.dataset.v = '';
        route();
      } else {
        userUI();
        window.updateHeroCampaign?.();
      }
    },
  };
}
function authBox(mode = 'in', after, note = '') {
  return loadAccount(() =>
    MilanoAccount.auth(
      accountContext(),
      mode,
      after,
      lang === 'en' ? trs(note) : note,
    ),
  );
}
async function loadAccount(open) {
  const generation = MilanoViewState.capture(),
    locale = lang,
    user = me()?.id;
  try {
    await MilanoModules.loadModule('account');
    if (
      MilanoViewState.current(generation) &&
      locale === lang &&
      user === me()?.id
    )
      open();
  } catch {
    toast(
      lang === 'en'
        ? 'Unable to load. Please try again.'
        : 'Не удалось загрузить. Попробуйте ещё раз.',
    );
  }
}
function userUI() {
  const u = me(),
    ab = $('#adm');
  if (!u) {
    SERVER_TICKET_COUNTS = null;
    SERVER_TICKETS_READY = false;
    SERVER_TICKETS_ERROR = false;
  }
  ab.hidden = !(u && u.role === 'admin');
  ab.onclick = () => (location.hash = '#/admin');
  $('#us').replaceChildren();
  const b = document.createElement('button');
  b.className = 'btn sm';
  b.id = u ? 'um' : 'li';
  b.textContent = u
    ? u.name.split(' ')[0]
    : lang === 'en'
      ? 'Sign in'
      : 'Войти';
  b.onclick = () =>
    u ? loadAccount(() => MilanoAccount.profile(accountContext())) : authBox();
  $('#us').append(b);
  updatePromoAccount();
}
/* raffle */
const campaignIsOpen = () =>
  !!SERVER_CAMPAIGN &&
  SERVER_CAMPAIGN.status === 'open' &&
  Date.parse(SERVER_CAMPAIGN.starts_at.replace(' ', 'T') + 'Z') <= Date.now() &&
  D.promo.end > Date.now();
function raffle() {
  if (!campaignIsOpen()) return toast(apiMessage('campaign_unavailable'));
  if (!me())
    return authBox(
      'reg',
      raffle,
      'Чтобы участвовать в розыгрыше, зарегистрируйтесь или войдите',
    );
  if (!window.MilanoAccount) return loadAccount(raffle);
  if (!me().email_verified)
    return MilanoAccount.verify(accountContext(), raffle);
  const o = modal(
    `<h3>Участвовать в розыгрыше</h3><p style="color:var(--m);font-size:13px">${t('receiptIntro')}</p><form><label>Чек (фото или PDF)<input name=receipt type=file accept="image/jpeg,image/png,image/webp,application/pdf" required></label><label class=ck><input type=checkbox name=consent required> ${lang === 'en' ? 'I consent to personal data processing and agree to the giveaway rules' : 'Согласен на обработку персональных данных и с правилами розыгрыша'}</label><div class=er></div><button class="btn pr">Отправить заявку</button></form>`,
  );
  let requestKey = crypto.randomUUID().replaceAll('-', '');
  $('input[type=file]', o).onchange = () => {
    requestKey = crypto.randomUUID().replaceAll('-', '');
  };
  const legalRow = document.createElement('div');
  legalRow.className = 'account-actions';
  for (const doc of LEGAL_DOCS.filter((d) =>
    ['privacy', 'raffle_rules'].includes(d.document_key),
  )) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm';
    b.textContent =
      lang === 'en'
        ? doc.document_key === 'privacy'
          ? 'Privacy consent (Russian draft)'
          : 'Giveaway rules (Russian draft)'
        : doc.title;
    b.onclick = () => MilanoAccount.showDocument(accountContext(), doc);
    legalRow.append(b);
  }
  $('form', o).append(legalRow);
  $('form', o).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.busy) return;
    const form = new FormData(f),
      file = form.get('receipt');
    if (file.size > 8e6)
      return ($('.er', o).textContent = apiMessage('receipt_too_large'));
    form.set('consent', 'yes');
    form.set(
      'document_version',
      LEGAL_DOCS.find((d) => d.document_key === 'privacy')?.version || '',
    );
    form.set(
      'rules_document_version',
      LEGAL_DOCS.find((d) => d.document_key === 'raffle_rules')?.version || '',
    );
    f.dataset.busy = '1';
    $('.er', o).textContent = '';
    const send = $('button[type=submit]', f) || $('button', f);
    const sendLabel = send.textContent;
    send.disabled = true;
    send.textContent = lang === 'en' ? 'Uploading receipt…' : 'Отправляем чек…';
    try {
      const r = await api('/campaigns/' + SERVER_CAMPAIGN.id + '/entries', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: form,
      });
      $('.md', o).innerHTML =
        `<h3>${lang === 'en' ? 'Receipt sent for review ✓' : 'Чек отправлен на проверку ✓'}</h3><p class="receipt-result" style="margin:12px 0 20px;color:var(--m)">${lang === 'en' ? 'Saved entry # ' : 'Сохранена заявка № '}${esc(r.data.id)}<br>${r.data.ticket_id ? (lang === 'en' ? 'Ticket: ' : 'Билет: ') + esc(r.data.ticket_id) : lang === 'en' ? 'The administrator will review the receipt and issue one ticket per confirmed MILANO can. Status and tickets are available in your account.' : 'Администратор проверит чек и начислит по одному билету за каждую подтверждённую банку MILANO. Статус и билеты доступны в личном кабинете.'}</p><button class="btn pr" id="receipt-done">${lang === 'en' ? 'Done' : 'Отлично'}</button>`;
      $('#receipt-done', o).onclick = () => o.remove();
      try {
        SERVER_ENTRIES = (await api('/me/entries')).data;
      } catch (_) {
        /* Saved receipt remains successful if account refresh fails. */
      }
      route();
    } catch (x) {
      const error = $('.er', o);
      if (error) error.textContent = apiMessage(x.message);
    } finally {
      delete f.dataset.busy;
      send.disabled = false;
      send.textContent = sendLabel;
    }
  };
}
/* hero helpers */
const SV = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC = {
  cart: SV(
    '<path d="M3 4h2l2.4 11h10.2l2-8H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  ),
  code: SV(
    '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><circle cx="12" cy="12" r="3"/>',
  ),
  user: SV(
    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  ),
  gift: SV(
    '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10 3 7.5 4.5 8 8 12 8zm0 0s2-5 4.5-3.5S16 8 12 8z"/>',
  ),
};
const defSt = (p) => [
  [String(p.kcal), 'ккал\n' + (p.kj || '') + ' кДж'],
  ['≤' + p.caf + ' мг', 'кофеин'],
  [p.taur + ' мг', 'таурин'],
  [p.carbs + ' г', 'углеводы'],
];
const stOf = (p) =>
    lang === 'en' ? p.st_en || p.st || defSt(p) : p.st || defSt(p),
  noteOf = (p) =>
    lang === 'en'
      ? (p.note_en ?? p.note ?? (p.vit ? 'B vitamins' : ''))
      : (p.note ?? (p.vit ? 'Витамины группы B' : '')),
  cutOf = (p) => p.cut || (p.img ? null : HC[p.code] || null);
const flavorName = (p) =>
  String(L(p, 'name') || '')
    .replace(/^MILANO\s*/i, '')
    .trim() || String(L(p, 'name') || 'MILANO');
const flavorStats = (p) =>
  stOf(p)
    .map(
      ([v, l]) =>
        `<li><b>${esc(v)}</b><span>${esc(l).replace(/\n/g, '<br>')}</span></li>`,
    )
    .join('');
const flavorCard = (p, i) =>
  `<article class="flavor-card" data-flavor-card data-i="${i}" style="--flavor-color:${col(p.color)}"><span class="age">18+</span><div class="flavor-card-media"><img src="${esc(img(p))}" alt="${esc(L(p, 'name'))}" loading="${i < 2 ? 'eager' : 'lazy'}"></div><div class="flavor-card-body"><h3>${esc(L(p, 'name'))}</h3><p class="flavor-card-taste">${esc(L(p, 'taste'))}</p><ul class="flavor-card-stats">${flavorStats(p)}</ul>${noteOf(p) ? `<p class="flavor-card-note">${esc(noteOf(p))}</p>` : ''}<p class="flavor-card-warning">${t('flavorWarning')}</p></div></article>`;
function legacyFlavorSection(P) {
  if (!P.length)
    return `<section class="sec flavors" id="flavors"><div class="w"><div class="flavors-head"><h2><span>${t('flavorsLead')}</span><span>${t('flavorsBrand')}</span></h2><p>0 ${t('flavorsCount')}</p></div></div></section>`;
  const p = P[0],
    stats = flavorStats(p),
    ticker = `<span>${t('marqueeEnergy')}</span><i>⚡</i><span>${t('marqueeFlavors')}</span><i>⚡</i>`;
  return `<section class="sec flavors" id="flavors" style="--active-color:${col(p.color)}" translate="no"><div class="energy-marquee" aria-hidden="true"><div>${ticker.repeat(4)}</div></div><div class="w2 flavors-wrap"><div class="flavors-head rv"><h2><span>${t('flavorsLead')}</span><span>${t('flavorsBrand')}</span></h2><p>${P.length} ${t('flavorsCount')}</p></div><div class="flavor-showcase rv" data-flavor-showcase><div class="flavor-stage"><span class="age">18+</span><div class="flavor-aura"></div><img class="flavor-main-image" src="${esc(img(p))}" alt="${esc(L(p, 'name'))}" fetchpriority="high"></div><div class="flavor-copy" aria-live="polite"><p class="flavor-brand">MILANO</p><h3 class="flavor-name">${esc(flavorName(p))}</h3><p class="flavor-taste">${esc(L(p, 'taste'))}</p><ul class="flavor-stats">${stats}</ul><p class="flavor-note"${noteOf(p) ? '' : ' hidden'}>${esc(noteOf(p))}</p><p class="flavor-warning">${t('flavorWarning')}</p><a class="btn pr flavor-cta" href="#where">${t('whereToBuy')}</a></div><div class="flavor-tabs" role="tablist" aria-label="${t('flavorCarousel')}">${P.map((x, i) => `<button type="button" role="tab" aria-selected="${i === 0}" tabindex="${i === 0 ? '0' : '-1'}" data-flavor-tab data-i="${i}" style="--flavor-color:${col(x.color)}"><span class="flavor-tab-thumb"><img src="${esc(cutOf(x) || img(x))}" alt="" loading="lazy"></span><span>${esc(flavorName(x))}</span></button>`).join('')}</div></div><div class="flavor-mobile rv"><div class="flavor-track" data-flavor-track role="region" aria-label="${t('flavorCarousel')}" tabindex="0">${P.map(flavorCard).join('')}</div><div class="flavor-mobile-meta"><p>${t('swipeFlavor')}</p><div class="flavor-controls"><button type="button" data-flavor-prev aria-label="${t('previousFlavor')}">←</button><button type="button" data-flavor-cycle aria-label="${t('pauseCarousel')}" aria-pressed="false">Ⅱ</button><button type="button" data-flavor-next aria-label="${t('nextFlavor')}">→</button></div></div></div></div></section>`;
}
function legacyInitFlavors(P) {
  const section = $('#flavors'),
    scene = $('[data-flavor-showcase]', section),
    track = $('[data-flavor-track]', section);
  if (!section || !scene || !track || !P.length) return;
  const tabs = $$('[data-flavor-tab]', section),
    main = $('.flavor-main-image', scene),
    name = $('.flavor-name', scene),
    taste = $('.flavor-taste', scene),
    stats = $('.flavor-stats', scene),
    note = $('.flavor-note', scene),
    cycle = $('[data-flavor-cycle]', section),
    previous = $('[data-flavor-prev]', section),
    next = $('[data-flavor-next]', section),
    motion = matchMedia('(prefers-reduced-motion:reduce)'),
    ctl = new AbortController(),
    on = (el, type, fn, opt = {}) =>
      el?.addEventListener(type, fn, { ...opt, signal: ctl.signal });
  let active = 0,
    request = 0,
    scrollTimer = 0,
    holdUntil = 0,
    stopped = false,
    visible = true,
    hovered = false,
    focused = false,
    jumping = false;
  const originals = $$('[data-flavor-card]', track);
  const before = originals.at(-1)?.cloneNode(true),
    after = originals[0]?.cloneNode(true);
  const prepareClone = (el, pos) => {
    if (!el) return;
    el.dataset.clone = pos;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('inert', '');
    $$('img', el).forEach((x) => (x.alt = ''));
  };
  if (P.length > 1) {
    prepareClone(before, 'before');
    prepareClone(after, 'after');
    track.prepend(before);
    track.append(after);
  }
  const cards = () => $$('[data-flavor-card]', track),
    center = (el) => el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2,
    jump = (el, smooth = true) => {
      if (!el) return;
      jumping = !smooth;
      track.scrollTo({
        left: center(el),
        behavior: smooth && !motion.matches ? 'smooth' : 'auto',
      });
      if (!smooth) requestAnimationFrame(() => (jumping = false));
    };
  const mark = (i) => {
    tabs.forEach((b, n) => {
      const yes = n === i;
      b.setAttribute('aria-selected', String(yes));
      b.tabIndex = yes ? 0 : -1;
    });
    originals.forEach((c, n) => c.classList.toggle('is-active', n === i));
  };
  const apply = (p) => {
    section.style.setProperty('--active-color', col(p.color));
    main.src = img(p);
    main.alt = L(p, 'name');
    name.textContent = flavorName(p);
    taste.textContent = L(p, 'taste');
    stats.innerHTML = flavorStats(p);
    const n = noteOf(p);
    note.textContent = n;
    note.hidden = !n;
    mark(active);
  };
  const select = async (i, animate = true) => {
    i = (i + P.length) % P.length;
    if (i === active && main.src.endsWith(img(P[i]))) return mark(i);
    active = i;
    const id = ++request,
      p = P[i],
      preload = new Image();
    preload.src = img(p);
    try {
      await preload.decode();
    } catch {}
    if (id !== request || !section.isConnected) return;
    if (animate && !motion.matches) {
      scene.classList.add('is-changing');
      await new Promise((r) => setTimeout(r, 150));
      if (id !== request || !section.isConnected) return;
    }
    apply(p);
    requestAnimationFrame(() => scene.classList.remove('is-changing'));
  };
  const closest = () =>
    cards().reduce(
      (best, c) =>
        Math.abs(center(c) - track.scrollLeft) <
        Math.abs(center(best) - track.scrollLeft)
          ? c
          : best,
      cards()[0],
    );
  const settle = () => {
    if (jumping) return;
    const c = closest();
    if (!c) return;
    const i = Number(c.dataset.i);
    select(i);
    if (c.dataset.clone === 'before')
      requestAnimationFrame(() => jump(originals.at(-1), false));
    else if (c.dataset.clone === 'after')
      requestAnimationFrame(() => jump(originals[0], false));
  };
  const pause = () => (holdUntil = Date.now() + 8000);
  const move = (dir) => {
    pause();
    if (MQ_P.matches) {
      const c = closest(),
        target = dir > 0 ? c?.nextElementSibling : c?.previousElementSibling;
      jump(target || originals[dir > 0 ? 0 : originals.length - 1]);
    } else select(active + dir);
  };
  tabs.forEach((b, i) => {
    on(b, 'click', () => {
      pause();
      select(i);
      b.focus();
    });
    on(b, 'keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const n =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? P.length - 1
            : (i + (e.key === 'ArrowRight' ? 1 : -1) + P.length) % P.length;
      tabs[n].click();
    });
  });
  on(
    track,
    'scroll',
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(settle, 110);
    },
    { passive: true },
  );
  on(track, 'pointerdown', pause, { passive: true });
  on(track, 'wheel', pause, { passive: true });
  on(track, 'keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      move(e.key === 'ArrowRight' ? 1 : -1);
    }
  });
  on(previous, 'click', () => move(-1));
  on(next, 'click', () => move(1));
  const cycleLabel = () => {
    cycle.textContent = stopped ? '▶' : 'Ⅱ';
    cycle.setAttribute('aria-pressed', String(stopped));
    cycle.setAttribute(
      'aria-label',
      t(stopped ? 'playCarousel' : 'pauseCarousel'),
    );
  };
  on(cycle, 'click', () => {
    stopped = !stopped;
    holdUntil = 0;
    cycleLabel();
  });
  on(section, 'mouseenter', () => (hovered = true));
  on(section, 'mouseleave', () => (hovered = false));
  on(section, 'focusin', () => (focused = true));
  on(section, 'focusout', (e) => {
    if (!section.contains(e.relatedTarget)) focused = false;
  });
  const io = new IntersectionObserver(
    (es) => (visible = es[0].isIntersecting),
    { threshold: 0.08 },
  );
  io.observe(section);
  const auto = setInterval(() => {
    if (
      stopped ||
      motion.matches ||
      !visible ||
      hovered ||
      focused ||
      document.hidden ||
      Date.now() < holdUntil ||
      P.length < 2
    )
      return;
    if (MQ_P.matches) {
      const c = closest(),
        target = c?.nextElementSibling;
      jump(target || originals[0]);
    } else select(active + 1);
  }, 6000);
  const mq = () =>
    requestAnimationFrame(() => MQ_P.matches && jump(originals[active], false));
  on(MQ_P, 'change', mq);
  requestAnimationFrame(() => MQ_P.matches && jump(originals[0], false));
  cycleLabel();
  mark(0);
  (window.swC = window.swC || []).push(() => {
    ++request;
    ctl.abort();
    io.disconnect();
    clearInterval(auto);
    clearTimeout(scrollTimer);
  });
}
const flavorContext = () => ({
  esc,
  t,
  img,
  name: flavorName,
  stats: flavorStats,
  note: noteOf,
  color: col,
  cut: (p) => cutOf(p) || HC[p.code] || HC[p.id] || null,
  taste: (p) => L(p, 'taste'),
  lang,
});
function flavorSection(P) {
  return MilanoFlavors.render(P, flavorContext());
}
function initFlavors(P) {
  (window.swC = window.swC || []).push(
    MilanoFlavors.mount($('#flavors'), P, flavorContext()),
  );
}
const CITY = [
  ['Санкт-Петербург', 17.6, 31.6],
  ['Москва', 19.4, 45.2],
  ['Казань', 28.8, 51.3],
  ['Екатеринбург', 37.7, 56.4],
  ['Краснодар', 9.1, 61.3],
  ['Новосибирск', 47.4, 69.7],
];
const MAP_LABELS = [
  [19.4, 29.5, 11.2, 2.8],
  [16.8, 48.7, 5.5, 2.8],
  [26.8, 53.8, 5.2, 2.8],
  [34.1, 59.3, 8, 2.8],
  [6.2, 63.9, 6.8, 2.8],
  [43.8, 72.3, 8, 2.8],
];
const PARTNER_HOOK =
  ''; /* сюда можно вписать URL вашего сервера/бота — заявки партнёров будут дополнительно отправляться POST-запросом (JSON) */
const MQ_M = matchMedia('(max-width:1100px)'),
  MQ_P = matchMedia('(max-width:760px)');
const lowPower = () =>
  matchMedia('(prefers-reduced-motion:reduce)').matches ||
  !!(navigator.connection && navigator.connection.saveData);
const QS = new URLSearchParams(location.search),
  FX =
    QS.get(
      'fx',
    ); /* ?fx=1 — принудительно все эффекты, ?fx=0 — статичная картинка, ?intro=1 — повторить вход */
const veryWeak = () =>
  FX == '0' ||
  (FX != '1' &&
    (((navigator.hardwareConcurrency || 8) <= 2 &&
      (navigator.deviceMemory || 8) <= 2) ||
      (navigator.deviceMemory || 8) < 1));
const fancy = () =>
  FX == '0'
    ? false
    : FX == '1'
      ? !MQ_M.matches
      : !MQ_M.matches &&
        matchMedia('(hover:hover)').matches &&
        !lowPower() &&
        (navigator.hardwareConcurrency || 8) >= 4 &&
        (navigator.deviceMemory || 8) >= 4;
const col = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#f2c230');
// Responsive styles preserve active forms; never reload on resize.
function stopHx() {
  window.updateHeroCampaign = null;
  clearInterval(window.cdt);
  window.heroCleanup?.();
  window.heroCleanup = null;
  (window.hxT || []).forEach(clearInterval);
  window.hxT = [];
  cancelAnimationFrame(window.hxR);
  (window.swC || []).forEach((f) => f());
  window.swC = [];
}
const cdv = () => {
  const s = Math.max(0, Math.floor((D.promo.end - Date.now()) / 1e3));
  return [s / 86400, (s % 86400) / 3600, (s % 3600) / 60, s % 60].map(
    Math.floor,
  );
};
const pad = (n) => String(n).padStart(2, '0');
function countUp(el, to) {
  if (lowPower()) {
    el.textContent = to.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + '+';
    return;
  }
  let frame = 0;
  const io = new IntersectionObserver((es) => {
    if (!es[0].isIntersecting) return;
    io.disconnect();
    const t0 = performance.now(),
      f = (n) => {
        if (!el.isConnected) return;
        const p = Math.min(1, (n - t0) / 1600),
          v = Math.round(to * (1 - Math.pow(1 - p, 3)));
        el.textContent =
          v.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + '+';
        if (p < 1) frame = requestAnimationFrame(f);
      };
    frame = requestAnimationFrame(f);
  });
  io.observe(el);
  (window.swC = window.swC || []).push(() => {
    io.disconnect();
    cancelAnimationFrame(frame);
  });
}
/* swipe carousel: бесконечная лента, автопрокрутка, пауза на 5 с после свайпа */
function swipe(el, auto, label) {
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', label);
  el.tabIndex = 0;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      el.scrollBy({
        left: (e.key === 'ArrowRight' ? 1 : -1) * el.clientWidth * 0.85,
        behavior: lowPower() ? 'instant' : 'smooth',
      });
    }
  });
}
function dockNav() {
  const dock = $('.mobile-dock');
  if (!dock) return;
  const links = $$('a[href^="#"]', dock),
    sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean),
    set = (id) =>
      links.forEach((a) => {
        const yes = a.getAttribute('href') === '#' + id;
        if (yes) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
  const io = new IntersectionObserver(
    (es) => {
      const hit = es
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (hit) set(hit.target.id);
    },
    { rootMargin: '-28% 0px -58% 0px', threshold: [0, 0.15, 0.4, 0.7] },
  );
  sections.forEach((s) => io.observe(s));
  links.forEach((a) => (a.onclick = () => set(a.hash.slice(1))));
  set(location.hash.slice(1) || 'flavors');
  (window.swC = window.swC || []).push(() => io.disconnect());
}
/* hero effects */
function scramble(els, dur) {
  const G = '█▓▒░#@$%&*+<>/|01';
  els.forEach((el, k) => {
    const t = el.dataset.t,
      n = t.length,
      t0 = performance.now() + k * 260,
      f = (now) => {
        const p = Math.min(1, Math.max(0, (now - t0) / dur));
        let s = '';
        for (let i = 0; i < n; i++)
          s +=
            t[i] == ' '
              ? ' '
              : p >= (i + 1) / n
                ? t[i]
                : G[(Math.random() * G.length) | 0];
        el.textContent = s;
        if (p < 1) requestAnimationFrame(f);
        else {
          el.textContent = t;
          el.classList.add('go');
        }
      };
    requestAnimationFrame(f);
  });
}
function rollCD(hx) {
  const els = $$('.hx-cd b', hx),
    t0 = performance.now();
  window.rolling = 1;
  const f = (now) => {
    const p = Math.min(1, (now - t0) / 1700),
      e = 1 - Math.pow(1 - p, 3),
      v = cdv();
    els.forEach((b, i) => (b.textContent = pad(Math.floor(v[i] * e))));
    if (p < 1) requestAnimationFrame(f);
    else window.rolling = 0;
  };
  requestAnimationFrame(f);
}
function rain(c) {
  const x = c.getContext('2d');
  let W, H;
  const d = [],
    rs = () => {
      const r = c.parentElement.getBoundingClientRect();
      W = c.width = r.width | 0;
      H = c.height = r.height | 0;
    };
  rs();
  for (let i = 0; i < 110; i++)
    d.push({
      x: Math.random() * W,
      y: Math.random() * H,
      l: 10 + Math.random() * 18,
      v: 9 + Math.random() * 9,
    });
  let vis = true;
  new IntersectionObserver((es) => (vis = es[0].isIntersecting)).observe(c);
  addEventListener('resize', () => c.isConnected && rs());
  const f = () => {
    window.hxR = requestAnimationFrame(f);
    if (!vis || document.hidden) return;
    x.clearRect(0, 0, W, H);
    x.strokeStyle = 'rgba(190,215,255,.2)';
    x.lineWidth = 1;
    x.beginPath();
    for (const p of d) {
      x.moveTo(p.x, p.y);
      x.lineTo(p.x - p.l * 0.22, p.y + p.l);
      p.y += p.v;
      p.x -= p.v * 0.22;
      if (p.y > H) {
        p.y = -20;
        p.x = Math.random() * W * 1.2;
      }
    }
    x.stroke();
  };
  f();
}
function heroMedia(hx) {
  window.heroCleanup = MilanoHero.mount(hx, {
    text: t,
    restricted: () => lowPower() || veryWeak(),
  });
}
/* partner */
function partner() {
  if (!me())
    return authBox(
      'in',
      partner,
      'Войдите или зарегистрируйтесь, чтобы отправить заявку партнёра',
    );
  const u = me();
  const o = modal(
    `<h3>Стать партнёром MILANO</h3><p style="color:var(--m);font-size:13px">Оставьте контакты — мы свяжемся с вами и обсудим условия сотрудничества.</p><form><label>ФИО<input name=name required value="${esc(u.name)}" autocomplete=name></label><label>Название организации<input name=org required autocomplete=organization></label><label>Телефон<input name=phone type=tel required value="${esc(u.phone)}" autocomplete=tel></label><label>Email<input name=email type=email required value="${esc(u.email)}" autocomplete=email></label><label class=ck><input type=checkbox required> Согласен на обработку персональных данных</label><div class=er></div><button class="btn pr">Стать партнёром</button></form>`,
  );
  const key = crypto.randomUUID().replaceAll('-', '');
  $('form', o).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.busy) return;
    const v = Object.fromEntries(new FormData(f));
    f.dataset.busy = '1';
    const send = $('button', f);
    send.disabled = true;
    try {
      const result = await api('/partners', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: {
          name: v.name,
          org: v.org,
          phone: v.phone,
          email: v.email,
          consent: true,
        },
      });
      $('.md', o).innerHTML =
        `<h3>${lang === 'en' ? 'Request received ✓' : 'Заявка принята ✓'}</h3><p style="margin:12px 0 20px;color:var(--m)">${lang === 'en' ? 'Your request has been saved. The team can now view it.' : 'Заявка сохранена. Команда увидит её в админ-панели.'}<br>${lang === 'en' ? 'Request # ' : 'Заявка № '}${esc(result.data.id)}</p><button class="btn pr" id="partner-done">${lang === 'en' ? 'Done' : 'Готово'}</button>`;
      $('#partner-done', o).onclick = () => o.remove();
    } catch (x) {
      $('.er', o).textContent = apiMessage(x.message);
    } finally {
      delete f.dataset.busy;
      send.disabled = false;
    }
  };
}
/* cards */
const bcard = (p) => {
  const pi = pimg(p.img),
    u = '#/post/' + p.id;
  return `<article class="bc"><a class="cv" href="${u}" style="${pi ? `background-image:url(${pi})` : ''}" aria-label="${esc(L(p, 'title'))}">${pi ? '' : '⚡'}</a><div class="bb"><small>${esc(L(p, 'tag'))}</small><h3><a href="${u}">${esc(L(p, 'title'))}</a></h3><p>${esc(L(p, 'excerpt'))}</p><a class="btn sm" href="${u}">Читать</a></div></article>`;
};
function blogPage() {
  stopHx();
  document.title = t('allArticles') + ' — MILANO';
  A.innerHTML = `<section class="sec" style="border:0"><div class="w"><h1 class="sr">Все статьи MILANO / STORIES</h1><a class="bk" href="#blog">← На главную</a><div class="sh" style="margin-top:18px"><div><h2>MILANO / STORIES</h2><p>Все статьи</p></div></div><div class="bl">${D.posts
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .map(bcard)
    .join('')}</div></div></section>`;
  scrollTo(0, 0);
  mountMotion('blog');
}
/* home */
function home() {
  stopHx();
  if (!CONTENT_READY) {
    A.innerHTML = `<div class="post"><h1>MILANO</h1><p>${CONTENT_ERROR ? esc(apiMessage(CONTENT_ERROR)) : lang === 'en' ? 'Loading website content…' : 'Загрузка содержимого сайта…'}</p><button class="btn" id="content-retry"${CONTENT_ERROR && !serverRefresh ? '' : ' disabled'}>${lang === 'en' ? 'Retry' : 'Повторить'}</button></div>`;
    $('#content-retry').onclick = () => {
      CONTENT_ERROR = '';
      home();
      refreshServer();
    };
    return;
  }
  const P = D.products.filter((p) => p.on !== false),
    mob = MQ_P.matches;
  let all = 0;
  const posts = () =>
    D.posts.filter((p) => all || p.home).sort((a, b) => b.ts - a.ts);
  const fan = P.map(cutOf).filter(Boolean).slice(0, 3),
    v0 = cdv();
  A.innerHTML = `<div class="hx-top"><div class="w2"><span class="hx-g">${IC.gift}<b>${t('campaignBadge')}</b></span><span class="hx-pz">${t('campaignPrizes')}</span></div></div>
 <section class="hx" id="top" aria-label="${t('giveaway')}">
 <div class="hx-tx"><div class="hx-eb">MILANO / PLAY YOUR WAY</div><h1><span class="gx l1">${t('heroLine1')}</span> <span class="gx l2">${t('heroLine2')}</span></h1><p class="hx-sub">${t('heroDescription')}</p><div class="hx-row"><button class="btn pr hx-btn" data-jr>${t('enter')} <span aria-hidden="true">↗</span></button><div class="hx-cdw"><small>${t('endsIn')}</small><div class="hx-cd" data-cd><div><b>${pad(v0[0])}</b><span>${t('days')}</span></div><em>:</em><div><b>${pad(v0[1])}</b><span>${t('hours')}</span></div><em>:</em><div><b>${pad(v0[2])}</b><span>${t('minutes')}</span></div><em>:</em><div><b>${pad(v0[3])}</b><span>${t('seconds')}</span></div></div></div></div></div>
 <div class="hero-scene"><div class="hx-st"><div class="hx-in"><img class="hx-poster" alt="${t('sceneAlt')}" fetchpriority="high"></div></div><div class="hero-caption"><p>${t('sceneCaption')}</p></div></div>
 <ol class="hx-steps"><li><span class="n">01</span>${IC.cart}<span>${t('stepBuy')}</span></li><li><span class="n">02</span>${IC.user}<span>${t('stepRegister')}</span></li><li><span class="n">03</span>${IC.code}<span>${t('stepReceipt')}</span></li><li><span class="n">04</span>${IC.gift}<span>${t('stepResults')}</span></li></ol></section>
${flavorSection(P)}
 <section class="sec pz" id="promo"><div class="w2 pz-g"><div class="pz-c rv"><h2><span>ИГРАЙ.</span><span>СОБИРАЙ.</span><span>ЗАБИРАЙ.</span></h2><p class="pz-p">${t('campaignDescription')}</p><ul class="pz-t"><li>Игровая консоль</li><li>Наушники</li><li>Рюкзак</li></ul><div class="cd" id="cd" data-cd><div><b>00</b><span>дней</span></div><div><b>00</b><span>часов</span></div><div><b>00</b><span>минут</span></div><div><b>00</b><span>секунд</span></div></div><button class="btn pr pz-b" data-jr>Участвовать в розыгрыше</button></div>
 <div class="pz-r rv"><div class="pz-k"><h3>ЛИЧНЫЙ КАБИНЕТ</h3><p id="pu"></p><div id="pb"></div></div><ol class="pz-s"><li><b>1</b><span>Купи любой вкус MILANO</span></li><li><b>2</b><span>Зарегистрируйся на сайте</span></li><li><b>3</b><span>Загрузи чек и жди итогов</span></li></ol></div></div></section>
<section class="sec wh" id="where"><div class="w2"><div class="wh-heading rv"><h2 class="wh-t"><span>ДОСТАВИМ</span><span class="g">КУДА УГОДНО</span></h2><div class="wh-n"><b id="wn">30 000+</b><span>точек продаж</span></div><p class="wh-p">Более 30 000 точек продаж по всей России. Выбирай удобный способ покупки</p></div>
<div class="wh-m rv"><div class="wh-sc" id="wsc"><div class="wh-mi"><img src="assets/map.webp" width="1672" height="941" alt="Карта доставки MILANO" loading="lazy">${CITY.map((c, i) => `<span class="map-label" style="left:${MAP_LABELS[i][0]}%;top:${MAP_LABELS[i][1]}%;width:${MAP_LABELS[i][2]}%;height:${MAP_LABELS[i][3]}%" aria-hidden="true">${esc(lang === 'en' ? EN[c[0]] : c[0])}</span><button class="mh" style="left:${c[1]}%;top:${c[2]}%" aria-pressed="false" aria-label="${c[0]}"><span class="tp">${c[0]}</span></button>`).join('')}</div></div></div>
<div class="wh-o rv"><h3>Онлайн-партнеры</h3><p>Заказать онлайн с доставкой:</p><div class="wh-b"><a class="mk oz" href="https://www.ozon.ru" target="_blank" rel="noopener"><i>OZON</i><span>Купить на Ozon</span></a><a class="mk wb" href="https://www.wildberries.ru" target="_blank" rel="noopener"><i>WB</i><span>Купить на WB</span></a><a class="mk ym" href="https://market.yandex.ru" target="_blank" rel="noopener"><i>Я</i><span>Купить на Маркете</span></a></div><button class="btn pr wh-pt" id="pt">Стать партнёром</button><small class="wh-h">Для магазинов, сетей и дистрибьюторов</small></div></div></section>
<section class="sec stories-section" id="blog"><div class="w"><div class="stories-heading"><div><h2>MILANO / <span>STORIES</span></h2><p>${lang === 'en' ? 'People. Events. Inspiration.' : 'Люди. События. Вдохновение.'}</p></div><a class="btn sm" id="all" href="#/blog">${t('allArticles')}</a></div><div id="bl"></div></div></section>
<section class="sec ab2" id="about"><div class="w2"><div class="ab2-h rv"><h2>ЭНЕРГИЯ БЕЗ КОМПРОМИССОВ</h2></div><div class="ab2-g"><div class="ab2-t rv"><p class="ld">MILANO — энергетические напитки для активной жизни: игровых турниров, экстремального спорта, ночных фестивалей и долгих рабочих смен.</p><p>Наша миссия — давать энергию без компромиссов в качестве. Мы производим напитки по стандартам GMP, из европейского сырья и с натуральным сахаром.</p><p>Каждый вкус линейки — отдельный характер: от классики до ярких фруктовых и ягодных нот. Яркая банка, холодный вкус и понятный состав — чтобы энергия была вашим выбором.</p><p>Вся линейка сертифицирована Центром халяльного надзора России. Мы за ответственное потребление: напиток не рекомендуется детям до 18 лет, а в MILANO / STORIES рассказываем, как пить энергетик с умом — вместе с водой, отдыхом и сном.</p></div><div class="ab2-v rv">${fan.map((s, i) => `<img class="c${i}" src="${s}" alt="MILANO" loading="lazy">`).join('')}</div></div>
<div class="ab2-s rv"><div><b>${P.length}</b><span>вкусов в линейке</span></div><div><b>GMP</b><span>стандарт производства</span></div><div><b>100%</b><span>натуральный сахар в составе</span></div><div><b>Халяль</b><span>вся линейка сертифицирована</span></div></div>
<div class="ab2-c rv"><div><i></i><h3>Энергия</h3><p>Кофеин и таурин для концентрации и выносливости — в игре, спорте и работе.</p></div><div><i></i><h3>Качество</h3><p>Производство по стандартам GMP и европейское сырьё.</p></div><div><i></i><h3>Вкус</h3><p>Натуральный сахар и яркие вкусы: мягкий подъём без лишних компромиссов.</p></div><div><i></i><h3>Доверие</h3><p>Сертификат Центра халяльного надзора России на всю линейку.</p></div></div></div></section>
<section class="sec" id="quality"><div class="w"><div class="hl rv"><img src="${HALAL}" alt="Халяль"><div><h2>СЕРТИФИКАТ ХАЛЯЛЬ</h2><p>Вся линейка MILANO сертифицирована Центром халяльного надзора России. Натуральный сахар и строгий контроль качества.</p><div class="tg"><span>Европа</span><span>Халяль</span><span>GMP</span></div></div></div></div></section>`;
  const hx = $('.hx');
  heroMedia(hx);
  /* Product showcase and mobile rail share CMS data and selected state. */
  initFlavors(P);
  dockNav();
  /* promo */
  $$('[data-jr]').forEach((b) => (b.onclick = raffle));
  const heroCountdownTemplate = $('.hx-cdw').innerHTML;
  const updateHeroCampaign = () => {
    if (!CAMPAIGN_READY) return;
    const open = campaignIsOpen(),
      state = $('.hx-cdw'),
      description = $('.hx-sub'),
      button = $('.hx-btn');
    if (SERVER_CAMPAIGN?.prizes?.length)
      description.textContent =
        (lang === 'en' ? 'Prizes: ' : 'Призы: ') +
        SERVER_CAMPAIGN.prizes
          .map(
            (p) =>
              (lang === 'en' ? trs(p.title) : p.title) +
              (Number(p.quantity) > 1 ? ' × ' + p.quantity : ''),
          )
          .join(' · ');
    else
      description.textContent =
        lang === 'en'
          ? 'Buy MILANO, register and upload your receipt.'
          : 'Купи MILANO, зарегистрируйся и загрузи чек.';
    if (open) {
      if (!state.querySelector('[data-cd]'))
        state.innerHTML = heroCountdownTemplate;
      $('.hx h1 .l1').textContent = t('heroLine1');
      $('.hx h1 .l2').textContent = t('heroLine2');
      button.replaceChildren(document.createTextNode(t('enter') + ' '));
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      button.append(arrow);
      button.onclick = raffle;
    } else {
      const ended =
        SERVER_CAMPAIGN &&
        (SERVER_CAMPAIGN.status === 'closed' || D.promo.end <= Date.now());
      state.replaceChildren();
      const message = document.createElement('span');
      message.className = 'hero-state';
      message.textContent = CAMPAIGN_ERROR
        ? lang === 'en'
          ? 'Giveaway information is temporarily unavailable'
          : 'Информация о розыгрыше временно недоступна'
        : ended
          ? t('ended')
          : lang === 'en'
            ? 'The next giveaway is being prepared'
            : 'Следующий розыгрыш готовится';
      if (ended) {
        $('.hx h1 .l1').textContent = lang === 'en' ? 'GIVEAWAY' : 'РОЗЫГРЫШ';
        $('.hx h1 .l2').textContent = lang === 'en' ? 'CLOSED' : 'ЗАВЕРШЁН';
      }
      state.append(message);
      $('#cd')?.remove();
      button.textContent = lang === 'en' ? 'Explore flavors' : 'Выбрать вкус';
      button.onclick = () => {
        history.pushState(null, '', '#flavors');
        route({ navigate: true });
      };
    }
  };
  window.updateHeroCampaign = updateHeroCampaign;
  updateHeroCampaign();
  updatePromoAccount();
  let heroWasOpen = campaignIsOpen();
  const tk = () => {
    if (heroWasOpen !== campaignIsOpen()) {
      heroWasOpen = campaignIsOpen();
      updateHeroCampaign();
    }
    const v = cdv();
    $$('[data-cd]').forEach((el) => {
      if (window.rolling && el.classList.contains('hx-cd')) return;
      $$('b', el).forEach((n, i) => (n.textContent = pad(v[i])));
    });
  };
  tk();
  clearInterval(window.cdt);
  window.cdt = setInterval(tk, 1e3);
  /* where */
  $$('.mh').forEach(
    (b) =>
      (b.onclick = () => {
        const o = b.classList.contains('on');
        $$('.mh').forEach((x) => {
          x.classList.remove('on');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.toggle('on', !o);
        b.setAttribute('aria-pressed', String(!o));
      }),
  );
  const sc = $('#wsc');
  if (window.MilanoDeliveryMap) {
    (window.swC = window.swC || []).push(
      window.MilanoDeliveryMap.mount($('#where'), CITY),
    );
  }
  if (sc && sc.scrollWidth > sc.clientWidth)
    sc.scrollLeft = sc.scrollWidth * 0.02;
  countUp($('#wn'), 30000);
  $('#pt').onclick = partner;
  for (const [i, key] of ['ozon_url', 'wb_url', 'market_url'].entries()) {
    const a = $$('.mk')[i];
    if (a) {
      const url = D.settings?.[key];
      if (url) a.href = url;
      else {
        a.removeAttribute('href');
        a.setAttribute('aria-disabled', 'true');
      }
    }
  }
  /* blog */
  $('#bl').innerHTML = MilanoStories.render(posts(), {
    esc,
    lang,
    text: L,
    image: (p) => pimg(p.img),
  });
  (window.swC = window.swC || []).push(MilanoStories.mount($('#blog')));
  mountMotion('home');
}

function mountMotion(view) {
  if (window.MilanoMotion)
    (window.swC = window.swC || []).push(MilanoMotion.mount(A, { view }));
  else $$('.rv').forEach((el) => el.classList.add('in'));
}

/* post */
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function md(src) {
  return src
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => {
      b = b.trim();
      if (!b) return '';
      if (b.startsWith('## ')) return `<h2>${fmt(b.slice(3))}</h2>`;
      if (b.startsWith('### ')) return `<h3>${fmt(b.slice(4))}</h3>`;
      if (b.startsWith('>> ')) return `<p class="sg">${fmt(b.slice(3))}</p>`;
      if (b.startsWith('> '))
        return `<blockquote>${fmt(b.slice(2)).replace(/\n/g, '<br>')}</blockquote>`;
      if (b.startsWith('^ ')) return `<p class="ld">${fmt(b.slice(2))}</p>`;
      if (/^[-+] /.test(b)) {
        const it = [];
        b.split('\n').forEach((l) =>
          /^[-+] /.test(l)
            ? it.push(l.slice(2))
            : (it[it.length - 1] += '\n' + l),
        );
        const o = b[0] == '+' ? 'ol' : 'ul';
        return `<${o}>${it.map((x) => `<li>${fmt(x).replace(/\n/g, '<br>')}</li>`).join('')}</${o}>`;
      }
      return `<p>${fmt(b).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}
function notFound() {
  stopHx();
  A.dataset.v = '';
  MilanoNotFound.render(A, { lang, homeHref: '/#top' });
  $('meta[name="robots"]').content = 'noindex,follow';
  scrollTo({ top: 0, behavior: 'instant' });
}
function post(id) {
  const p = D.posts.find((x) => x.id == id);
  if (!p) return notFound();
  document.title = L(p, 'title') + ' — MILANO';
  const body = L(p, 'body'),
    n = Math.max(1, Math.round(body.split(/\s+/).length / 190)),
    pi = pimg(p.img);
  A.innerHTML = `<article class="post post-entry"><a class="bk" href="#blog">← К статьям</a>${pi ? `<img class="pc" src="${pi}" alt="">` : ''}<div class="pm"><span>${esc(L(p, 'tag'))}</span><span>${new Date(p.ts).toLocaleDateString(loc())}</span><span>${n} ${lang == 'en' ? 'min read' : 'мин чтения'}</span></div><h1>${esc(L(p, 'title'))}</h1><div class="pb">${md(body)}${(p.imgs || []).map((s) => `<img src="${s}" alt="">`).join('')}</div><p class="wr2">Не рекомендуется детям до 18 лет.</p><a class="btn" href="#blog">← К статьям</a></article>`;
  scrollTo(0, 0);
  mountMotion('post:' + id);
}
/* admin */
let tab = 'overview';
function adminAccess() {
  A.innerHTML =
    '<div class="post"><h1>' +
    (lang === 'en'
      ? 'Administrator access only'
      : 'Доступ только для администратора') +
    '</h1><button class="btn pr" id="x">' +
    (lang === 'en' ? 'Sign in' : 'Войти') +
    '</button></div>';
  $('#x').onclick = () => authBox('in', route);
}
async function admin() {
  const u = me();
  if (!u || u.role !== 'admin') return adminAccess();
  if (window.MilanoCMS && typeof renderAdmin === 'function')
    return renderAdmin();
  const generation = MilanoViewState.capture(),
    locale = lang;
  A.innerHTML =
    '<div class="post" role="status">' +
    (lang === 'en' ? 'Loading dashboard…' : 'Загрузка панели…') +
    '</div>';
  try {
    await MilanoModules.loadModule('admin');
    if (
      MilanoViewState.current(generation) &&
      locale === lang &&
      me()?.id === u.id &&
      location.hash.startsWith('#/admin')
    )
      renderAdmin();
  } catch {
    if (!MilanoViewState.current(generation)) return;
    A.innerHTML =
      '<div class="post"><p>' +
      (lang === 'en'
        ? 'Unable to load dashboard.'
        : 'Не удалось загрузить панель.') +
      '</p><button class="btn" id="admin-retry">' +
      (lang === 'en' ? 'Retry' : 'Повторить') +
      '</button></div>';
    $('#admin-retry').onclick = admin;
  }
}
const menu = (open) => {
  $('#nv').classList.toggle('o', open);
  $('#bg').setAttribute('aria-expanded', String(open));
};
$('#bg').setAttribute('aria-controls', 'nv');
$('#bg').setAttribute('aria-expanded', 'false');
$('#bg').onclick = () => menu(!$('#nv').classList.contains('o'));
$$('#nv a').forEach((a) => (a.onclick = () => menu(false)));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') menu(false);
});
const aT = () => {
  document.documentElement.dataset.theme = 'dark';
  try {
    localStorage.removeItem('mt');
  } catch {}
  $('meta[name="theme-color"]').content = '#07080a';
};
const aL = () => {
  document.documentElement.lang = lang;
  $('#lg').textContent = lang === 'en' ? 'RU' : 'EN';
  $('#lg').setAttribute(
    'aria-label',
    lang === 'en' ? 'Switch to Russian' : 'Switch to English',
  );
  document.title = t('pageTitle');
  $('meta[name="description"]').content = t('pageDescription');
  $('meta[property="og:locale"]').content = lang === 'en' ? 'en_US' : 'ru_RU';
  for (const s of ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
    $(s).content = t('pageTitle');
  $('meta[property="og:description"]').content = t('pageDescription');
  const schema = $('script[type="application/ld+json"]');
  if (schema) {
    const data = JSON.parse(schema.textContent);
    data['@graph'][0].description = t('pageDescription');
    data['@graph'][0].slogan =
      lang === 'en' ? 'Play your way' : 'Заряди свой режим';
    data['@graph'][1].name = lang === 'en' ? 'MILANO flavors' : 'Вкусы MILANO';
    data['@graph'][1].itemListElement.forEach(
      (x) =>
        (x.item.category =
          lang === 'en' ? 'Energy drink' : 'Энергетический напиток'),
    );
    schema.textContent = JSON.stringify(data);
  }
  aT();
};
$('#lg').onclick = () => {
  lang = lang == 'en' ? 'ru' : 'en';
  ss('ml', lang);
  aL();
  if (CONTENT_READY) renderContacts();
  walk(document.body);
  A.dataset.v = '';
  userUI();
  route();
  walk(document.body);
};
// Only deliberate navigation scrolls. Data refreshes and profile updates do not.
document.addEventListener('click', (event) => {
  const a = event.target.closest('a[href^="#"]');
  if (
    !a ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const hash = a.getAttribute('href');
  if (!MilanoRuntime.isSectionHash(hash)) return;
  event.preventDefault();
  if (location.hash !== hash) history.pushState(null, '', hash);
  route({ navigate: true });
});
addEventListener('hashchange', () => route({ navigate: true }));
let siteStarted = false;
const startSite = () => {
  siteStarted = true;
  lang = document.documentElement.lang === 'en' ? 'en' : 'ru';
  aT();
  aL();
  userUI();
  walk(document.body);
  route();
  scrollTo({ top: 0, behavior: 'instant' });
  refreshServer();
};
addEventListener('milano:agechange', (event) => {
  if (
    event.detail.allowed &&
    siteStarted &&
    lang !== document.documentElement.lang
  )
    $('#lg').click();
});
if (window.MilanoAgeGate) MilanoAgeGate.whenAllowed(startSite);
else if (!document.documentElement.hasAttribute('data-age-state')) startSite();
addEventListener('pageshow', (event) => {
  if (
    event.persisted &&
    (!location.hash ||
      MilanoRuntime.isSectionHash(location.hash) ||
      location.hash === '#/')
  ) {
    history.replaceState(null, '', location.pathname + location.search);
    pendingSection = null;
    cancelAnimationFrame(sectionFrame);
    scrollTo({ top: 0, behavior: 'instant' });
  }
});
