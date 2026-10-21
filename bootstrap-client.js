// Выполняется до отрисовки: сохраняет прежнюю тему, язык и поведение главной.
document.documentElement.dataset.theme = 'dark';
try {
  history.scrollRestoration = 'manual';
  if (
    /^#(?:top|flavors|promo|where|blog|about|quality|A|\/?)$/.test(
      location.hash,
    )
  ) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  localStorage.removeItem('mt');
  document.documentElement.lang =
    localStorage.getItem('ml') === 'en' ? 'en' : 'ru';
} catch (_error) {
  /* Хранилище может быть недоступно в приватном режиме. */
}
document.documentElement.setAttribute('data-content-state', 'loading');
