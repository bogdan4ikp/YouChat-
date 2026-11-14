'use strict';

/* Мобильное поведение: системная кнопка «Назад», клавиатура, «вниз», сохранение при сворачивании */
(function () {
  const app = $('#app');
  const isMobile = () => window.innerWidth <= 960;
  const chatOpen = () => app.classList.contains('chat-open') && isMobile();

  /* --- кнопка «Назад» закрывает шторку, затем чат, а не всю страницу --- */
  let layers = 0;
  let ignore = 0;
  let queued = false;
  const needed = () => (chatOpen() ? 1 : 0) + modalStack.length;
  function sync() {
    queued = false;
    const need = needed();
    while (layers < need) { history.pushState({ aurora: 1 }, ''); layers += 1; }
    if (layers > need) {
      const back = layers - need;
      layers = need;
      ignore += 1;
      history.go(-back);
    }
  }
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(sync); } };
  new MutationObserver(schedule).observe(app, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(schedule).observe($('#modalLayer'), { childList: true });
  ['closeModal', 'openModal'].forEach((name) => {
    const original = window[name];
    window[name] = function () { const result = original.apply(this, arguments); schedule(); return result; };
  });
  window.addEventListener('popstate', () => {
    if (ignore > 0) { ignore -= 1; return; }
    if (layers > 0) layers -= 1;
    if (!$('#lightbox').hidden && typeof closeLightbox === 'function') { closeLightbox(); return; }
    closePopover();
    if (modalStack.length) closeModal();
    else if (chatOpen()) app.classList.remove('chat-open');
    schedule();
  });

  /* --- экранная клавиатура: высота приложения = видимая область --- */
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      document.documentElement.style.setProperty('--app-h', Math.round(vv.height) + 'px');
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', () => { fit(); if (document.activeElement === $('#composerInput')) scrollBottom(false); });
    vv.addEventListener('scroll', fit);
    fit();
  }
  $('#composerInput').addEventListener('focus', () => setTimeout(() => scrollBottom(false), 280));

  /* --- кнопка «вниз» --- */
  const scroller = $('#chatScroll');
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'scroll-down';
  down.setAttribute('aria-label', 'К последним сообщениям');
  down.innerHTML = icon('chev');
  $('#composerArea').append(down);
  down.addEventListener('click', () => scrollBottom(true));
  scroller.addEventListener('scroll', () => {
    down.classList.toggle('is-on', scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 320);
  }, { passive: true });

  /* --- не терять данные, когда мобильный браузер выгружает вкладку --- */
  window.addEventListener('pagehide', flushPersist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushPersist(); });

  /* --- при расширении окна до десктопа сбрасываем мобильный режим чата --- */
  window.addEventListener('resize', () => { if (!isMobile()) app.classList.remove('chat-open'); });
})();
