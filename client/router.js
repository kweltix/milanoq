/* router */
let RESET_PAGE_KEY = null,
  sectionFrame = 0;
function route({ navigate = false } = {}) {
  if (
    document.documentElement.hasAttribute('data-age-state') &&
    !window.MilanoAgeGate?.allowed
  )
    return;
  MilanoViewState.advance();
  const h = location.hash;
  if (navigate || h.startsWith('#/')) cancelAnimationFrame(sectionFrame);
  document.title = t('pageTitle');
  $('meta[name="robots"]').content = 'index,follow';
  $('#nv').classList.remove('o');
  $('#bg').setAttribute('aria-expanded', 'false');
  if (/^#\/reset(?:\?|$)/.test(h)) {
    const token = new URLSearchParams(h.split('?')[1] || '').get('token') || '',
      key = lang + ':' + token;
    if (RESET_PAGE_KEY === key && A.classList.contains('account-reset')) return;
    RESET_PAGE_KEY = key;
    document.querySelectorAll('.ov').forEach((o) => o.remove());
    stopHx();
    loadAccount(() => MilanoAccount.resetPage(accountContext(), A, token));
    return;
  }
  RESET_PAGE_KEY = null;
  A.classList.remove('post', 'account-reset');
  A.removeAttribute('translate');
  if (h.startsWith('#/post/')) {
    stopHx();
    if (!CONTENT_READY) {
      home();
      return;
    }
    post(h.slice(7));
  } else if (/^#\/admin(?:\?|$)/.test(h)) {
    stopHx();
    admin();
  } else if (h == '#/blog') {
    blogPage();
    A.dataset.v = '';
  } else if (!h || h === '#/' || MilanoRuntime.isSectionHash(h)) {
    if (!$('#flavors') || A.dataset.v != 'h') {
      home();
      A.dataset.v = 'h';
    }
    const id = h.slice(1);
    if (navigate) {
      if (!CONTENT_READY) {
        pendingSection = id;
        return;
      }
      pendingSection = null;
      sectionFrame = requestAnimationFrame(() => {
        if (id && !id.startsWith('/'))
          document
            .getElementById(id)
            ?.scrollIntoView({ behavior: lowPower() ? 'instant' : 'smooth' });
        else scrollTo({ top: 0, behavior: 'instant' });
      });
    }
    return;
  } else {
    notFound();
    return;
  }
  A.dataset.v = '';
}
