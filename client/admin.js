function renderAdmin() {
  document.querySelector('#ap')?._milanoCampaignCleanup?.();
  const u = me();
  if (!u || u.role != 'admin') {
    A.innerHTML =
      '<div class="post"><h1>Доступ только для администратора</h1><p>Войдите под учётной записью администратора.</p><button class="btn pr" id="x">Войти</button></div>';
    return ($('#x').onclick = () => authBox('in', route));
  }
  const T = {
    overview: lang === 'en' ? 'Giveaways' : 'Розыгрыши',
    fl: lang === 'en' ? 'Flavors' : 'Вкусы',
    bl: lang === 'en' ? 'Articles' : 'Блог',
    pt: lang === 'en' ? 'Partner requests' : 'Заявки партнёров',
    media: lang === 'en' ? 'Images' : 'Изображения',
    settings: lang === 'en' ? 'Site settings' : 'Настройки сайта',
  };
  const requestedSection = new URLSearchParams(
    location.hash.split('?')[1] || '',
  ).get('section');
  if (requestedSection && T[requestedSection]) tab = requestedSection;
  else if (location.hash.includes('campaign=')) tab = 'overview';
  if (!T[tab]) tab = 'overview';
  A.innerHTML = `<div class="w ad"><div class="side">${Object.entries(T)
    .map(
      ([k, v]) =>
        `<button data-k="${k}" class="${k == tab ? 'on' : ''}">${v}</button>`,
    )
    .join(
      '',
    )}<a class="btn" href="#/" style="margin-top:10px">← На сайт</a></div><div id="ap"></div></div>`;
  $$('.side button').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.k;
        history.replaceState(
          null,
          '',
          '#/admin?section=' + encodeURIComponent(tab),
        );
        admin();
      }),
  );
  const P = $('#ap');
  if (tab === 'overview') {
    const openCampaign = (id, userId) => {
      if (!MilanoGuard.leave()) return;
      P._milanoCampaignCleanup?.();
      history.replaceState(
        null,
        '',
        '#/admin?campaign=' + encodeURIComponent(id),
      );
      MilanoCampaign.render(P, {
        api,
        lang,
        campaignId: id,
        initialUserId: typeof userId === 'string' ? userId : null,
        onBack: () => {
          history.replaceState(null, '', '#/admin');
          admin();
        },
        onNavigateCampaign: openCampaign,
        onExport: campaignExcel,
      });
    };
    const selected = new URLSearchParams(location.hash.split('?')[1] || '').get(
      'campaign',
    );
    if (selected && /^[a-f0-9]{32}$/.test(selected)) openCampaign(selected);
    else MilanoAdmin.render(P, { api: adminApi, lang, openCampaign });
  } else
    MilanoCMS.render(
      P,
      { api, lang, refreshContent, preview: previewContent },
      { fl: 'products', bl: 'articles', pt: 'partners' }[tab] || tab,
    );
}
async function campaignExcel({ campaignId, scope, filters, lang, signal }) {
  const ctl = new AbortController(),
    abort = () => ctl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 60000);
  try {
    const response = await fetch(
      '/api/v1/admin/workspace/' + campaignId + '/export',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
        body: JSON.stringify({ scope, filters, lang }),
        signal: ctl.signal,
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.code || 'export_failed');
    }
    const blob = await response.blob(),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'milano-' + campaignId + '.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
