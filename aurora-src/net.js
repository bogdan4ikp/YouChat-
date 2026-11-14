'use strict';

const NET = (() => {
  const cfg = {
    enabled: true,
    online: false,
    booted: false,
    booting: false,
    starting: false,
    me: null,
    profile: null,
    mode: 'login',
    stream: null,
    timer: null,
    refreshing: false,
    again: false,
    authWired: false,
    bound: false,
    statusNode: null,
    presenceTimer: null
  };

  function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(async (res) => {
      let data = null;
      const text = await res.text();
      if (text) {
        try { data = JSON.parse(text); } catch (error) { data = null; }
      }
      if (!res.ok) {
        if (res.status === 401 && !opts.allow401) onUnauthorized();
        const error = new Error((data && data.error) || 'Ошибка сервера');
        error.status = res.status;
        if (opts.allow404 && res.status === 404) return null;
        throw error;
      }
      return data;
    });
  }

  function online() {
    return cfg.enabled && cfg.online;
  }

  function applyState(payload) {
    if (!payload || !payload.me) return;
    const prevActive = typeof state !== 'undefined' ? state.activeId : null;
    const prevPrefs = typeof state !== 'undefined' ? state.prefs : null;
    const convs = Array.isArray(payload.conversations) ? payload.conversations : [];
    const keep = convs.some((c) => c.id === prevActive) ? prevActive : (convs[0] ? convs[0].id : null);
    state = {
      v: 3,
      me: payload.me,
      people: payload.people || {},
      conversations: convs,
      activeId: keep,
      prefs: prevPrefs || { membersOpen: window.innerWidth > 1180 }
    };
    cfg.me = payload.me;
    if (payload.profile) cfg.profile = payload.profile;
  }

  function applyAndRender(payload) {
    if (!payload || !cfg.booted) {
      applyState(payload);
      return;
    }
    const scroller = document.getElementById('chatScroll');
    const stick = scroller ? (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) < 120 : true;
    const top = scroller ? scroller.scrollTop : 0;
    applyState(payload);
    if (typeof renderAll === 'function') renderAll();
    if (scroller) {
      scroller.scrollTop = stick ? scroller.scrollHeight : top;
      requestAnimationFrame(() => {
        if (!scroller) return;
        const now = document.getElementById('chatScroll');
        if (!now) return;
        now.scrollTop = stick ? now.scrollHeight : top;
      });
    }
  }

  function refresh() {
    if (!online()) return;
    if (cfg.refreshing) {
      cfg.again = true;
      return;
    }
    clearTimeout(cfg.timer);
    cfg.timer = setTimeout(runRefresh, 130);
  }

  async function runRefresh() {
    if (!online()) return;
    cfg.refreshing = true;
    try {
      const data = await api('/api/state');
      if (data && data.state) applyAndRender(data.state);
    } catch (error) {
      if (!error.status || error.status >= 500) setStatus('Нет связи с сервером');
    } finally {
      cfg.refreshing = false;
      if (cfg.again) {
        cfg.again = false;
        refresh();
      }
    }
  }

  function setStatus(text) {
    if (!cfg.statusNode) {
      cfg.statusNode = document.createElement('div');
      cfg.statusNode.className = 'net-status';
      cfg.statusNode.hidden = true;
      cfg.statusNode.innerHTML = '<span class="dot"></span><span></span>';
      document.body.append(cfg.statusNode);
    }
    const label = cfg.statusNode.querySelector('span:last-child');
    if (!text) {
      cfg.statusNode.hidden = true;
      return;
    }
    if (label) label.textContent = text;
    cfg.statusNode.hidden = false;
  }

  function connectStream() {
    if (cfg.stream) {
      try { cfg.stream.close(); } catch (error) { /* ignore */ }
      cfg.stream = null;
    }
    if (!online() || typeof EventSource === 'undefined') return;
    const stream = new EventSource('/api/stream');
    cfg.stream = stream;
    stream.onopen = () => setStatus('');
    stream.onerror = () => {
      if (online()) setStatus('Переподключение…');
    };
    stream.onmessage = (event) => {
      let payload = null;
      try { payload = JSON.parse(event.data); } catch (error) { return; }
      if (!payload) return;
      if (payload.type === 'hello') {
        setStatus('');
        return;
      }
      if (payload.type === 'request-declined') {
        if (typeof toast === 'function') toast('Заявка на вступление отклонена', 'warn');
        refresh();
        return;
      }
      refresh();
    };
  }

  function stopStream() {
    if (!cfg.stream) return;
    try { cfg.stream.close(); } catch (error) { /* ignore */ }
    cfg.stream = null;
  }

  function onUnauthorized() {
    if (!cfg.online) return;
    cfg.online = false;
    stopStream();
    setStatus('');
    if (typeof toast === 'function') toast('Сессия истекла — войдите снова', 'warn');
    showAuth('login');
  }

  function bootApp() {
    if (cfg.booted) return;
    cfg.booted = true;
    document.body.classList.remove('app-booting');
    if (typeof initApp === 'function') initApp();
    bindExtras();
  }

  function enter(payload) {
    applyState(payload);
    cfg.online = true;
    hideAuth();
    document.body.classList.remove('app-booting');
    bootApp();
    if (typeof renderAll === 'function') renderAll();
    connectStream();
    if (!cfg.presenceTimer) {
      cfg.presenceTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && online()) refresh();
      }, 45000);
    }
    setTimeout(handleDeepLink, 120);
    maybeOnboarding();
  }

  function authMarkup() {
    return `
    <div class="auth-card" role="dialog" aria-modal="true" aria-label="Вход в YouChat">
      <div class="auth-brand">
        <span class="auth-mark logo-art" aria-hidden="true"></span>
        <div class="auth-brand-text">
          <h1 class="auth-title">YouChat</h1>
          <p class="auth-tag">мессенджер, который живёт на сервере</p>
        </div>
      </div>
      <h2 class="auth-headline">Ваши люди.<br>В любом браузере.</h2>
      <p class="auth-lead">Один вход — и переписка, группы и профиль на месте. Через Яндекс ID это два клика: имя и фото придут из вашего профиля.</p>
      <button type="button" class="btn-yandex auth-yandex">
        <span class="yandex-mark" aria-hidden="true">Я</span>
        <span class="yandex-label">Войти через Яндекс ID</span>
        <span class="yandex-arrow" aria-hidden="true">→</span>
      </button>
      <p class="auth-note" data-yandex-note hidden></p>

      <p class="auth-error" hidden></p>
      <p class="auth-hint">Аккаунт, переписки и вложения хранятся на сервере YouChat. Через Яндекс ID пароль не нужен.</p>
    </div>`;
  }

  function authBackground() {
    const screen = document.getElementById('authScreen');
    if (!screen || screen.querySelector('.auth-aurora')) return;
    const layer = document.createElement('div');
    layer.className = 'auth-aurora';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = '<i></i><i></i><i></i><i></i><span class="auth-grid"></span>';
    screen.prepend(layer);
  }

  function yandexNote(text) {
    const screen = document.getElementById('authScreen');
    if (!screen) return;
    const note = screen.querySelector('[data-yandex-note]');
    if (!note) return;
    note.textContent = text || '';
    note.hidden = !text;
  }

  function ensureAuth() {
    let screen = document.getElementById('authScreen');
    if (!screen) {
      screen = document.createElement('div');
      screen.id = 'authScreen';
      screen.className = 'auth-screen';
      screen.hidden = true;
      document.body.append(screen);
    }
    if (!cfg.authWired) {
      cfg.authWired = true;
      screen.addEventListener('click', (event) => {
        const modeBtn = event.target.closest('[data-auth-mode]');
        if (modeBtn) {
          setAuthMode(modeBtn.dataset.authMode);
          return;
        }
        if (event.target.closest('.auth-yandex')) {
          startYandex();
          return;
        }
      });
    }
    return screen;
  }

  function startYandex() {
    location.assign('/api/auth/yandex/start');
  }

  async function submitAuth() {
    const screen = document.getElementById('authScreen');
    if (!screen) return;
    const usernameInput = screen.querySelector('.auth-username');
    const passwordInput = screen.querySelector('.auth-password');
    const nameInput = screen.querySelector('.auth-name');
    const submit = screen.querySelector('.auth-submit');
    if (!usernameInput || !passwordInput || !submit) return;
    const username = String(usernameInput.value || '').trim().toLowerCase().replace(/^@/, '');
    const password = String(passwordInput.value || '');
    const name = String(nameInput ? nameInput.value : '').trim();
    const register = cfg.mode === 'register';
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      showError('Логин: 3–24 символа, латиница, цифры и _');
      usernameInput.focus();
      return;
    }
    if (password.length < 6) {
      showError('Пароль должен быть не короче 6 символов');
      passwordInput.focus();
      return;
    }
    if (register && (name.length < 2 || name.length > 32)) {
      showError('Имя от 2 до 32 символов');
      return;
    }
    submit.disabled = true;
    showError('');
    try {
      const data = await api(register ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: register ? { username, password, name } : { username, password },
        allow401: true
      });
      if (data && data.state) enter(data.state);
    } catch (error) {
      showError(error.message || 'Не удалось войти');
    } finally {
      submit.disabled = false;
    }
  }

  function showError(text) {
    const screen = document.getElementById('authScreen');
    if (!screen) return;
    const box = screen.querySelector('.auth-error');
    if (!box) return;
    box.textContent = text || '';
    box.hidden = !text;
  }

  function isLocalHost() {
    return ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  }

  function showAuth() {
    const screen = ensureAuth();
    if (!screen.querySelector('.auth-card')) screen.innerHTML = authMarkup();
    authBackground();
    screen.hidden = false;
    document.body.classList.add('app-booting');
    showError('');
    const yandexBtn = screen.querySelector('.auth-yandex');
    if (cfg.yandex === false) {
      yandexNote('Регистрация через Яндекс ID пока не настроена. Администратору нужно добавить Client ID и новый Client Secret в переменные Railway.');
      if (yandexBtn) yandexBtn.disabled = true;
    } else {
      yandexNote(isLocalHost()
        ? 'Для входа откройте публичный адрес YouChat — авторизация Яндекса возвращает пользователя на сайт.'
        : '');
      if (yandexBtn) {
        yandexBtn.disabled = false;
        setTimeout(() => yandexBtn.focus(), 80);
      }
    }
    applyAuthQuery();
  }

  function applyAuthQuery() {
    const params = new URLSearchParams(location.search);
    const kind = params.get('auth');
    if (!kind) return;
    const reason = params.get('reason') || '';
    const reasons = {
      cancelled: 'Вход через Яндекс ID отменён. Попробуйте ещё раз.',
      token: 'Яндекс не принял ключи приложения — проверьте YANDEX_CLIENT_ID и YANDEX_CLIENT_SECRET.',
      profile: 'Не удалось получить профиль Яндекса. Попробуйте ещё раз.',
      state: 'Сессия входа устарела — попробуйте снова.',
      disabled: 'Вход через Яндекс ID отключён на сервере.',
      error: 'Не получилось войти через Яндекс ID. Попробуйте ещё раз.'
    };
    if (kind === 'logout') {
      yandexNote('Вы вышли из аккаунта. Чтобы вернуться, войдите через Яндекс ID.');
    } else if (kind === 'yandex_error') {
      showError(reasons[reason] || reasons.error);
    } else if (kind === 'yandex_unconfigured') {
      showError('Вход через Яндекс ID не настроен на сервере.');
    }
    try { history.replaceState({}, '', location.pathname); } catch (error) { /* ignore */ }
  }

  function hideAuth() {
    const screen = document.getElementById('authScreen');
    if (screen) screen.hidden = true;
    document.body.classList.remove('app-booting');
  }

  function cleanUsername(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  }

  function onboardingMarkup() {
    const person = (state.people && state.people[state.me]) || {};
    const draft = {
      name: person.name || '',
      username: person.username || '',
      bio: person.bio || '',
      birthday: (cfg.profile && cfg.profile.birthday) || '',
      grad: person.grad || 0,
      banner: person.banner || 'aurora',
      bannerImg: person.bannerImg || '',
      avatar: person.avatar || null
    };
    return `<div class="ob-card" role="dialog" aria-modal="true" aria-label="Профиль в YouChat">
      <div class="ob-head">
        <span class="ob-logo logo-art" aria-hidden="true"></span>
        <div class="ob-head-text">
          <h1 class="ob-title">Давайте знакомиться</h1>
          <p class="ob-lead">Имя и фото подставили из Яндекс ID — поправьте, если нужно. Остальное можно заполнить позже.</p>
        </div>
      </div>
      <div class="ob-preview">
        <div class="ob-banner" id="obBanner">${bannerHTML(draft.banner, '', draft.bannerImg)}</div>
        <div class="ob-idrow">
          <span class="ob-avatar" id="obAvatar">${avatarHTML(draft, 88, {})}</span>
          <div class="ob-idtext">
            <div class="ob-name" id="obName">${esc(draft.name || 'Ваше имя')}</div>
            <div class="ob-user" id="obUser">@${esc(draft.username || 'username')}</div>
          </div>
        </div>
      </div>
      <form id="obForm" class="ob-form" novalidate>
        <label class="ob-field">
          <span class="ob-label">Как вас зовут</span>
          <input class="input" id="obNameInput" maxlength="32" autocomplete="name" value="${esc(draft.name)}" placeholder="Имя и фамилия">
        </label>
        <label class="ob-field">
          <span class="ob-label">Короткий адрес</span>
          <span class="ob-userinput"><b>@</b><input class="input" id="obUserInput" maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(draft.username)}"></span>
          <span class="ob-note" id="obUserNote">Только латиница, цифры и _ — от 3 до 24 символов</span>
        </label>
        <div class="ob-grid">
          <label class="ob-field">
            <span class="ob-label">О себе <i>необязательно</i></span>
            <textarea class="input" id="obBio" maxlength="190" rows="2" placeholder="Чем занимаетесь, что любите">${esc(draft.bio)}</textarea>
          </label>
          <label class="ob-field">
            <span class="ob-label">Дата рождения <i>необязательно</i></span>
            <input class="input" id="obBirthday" type="date" value="${esc(draft.birthday)}">
          </label>
        </div>
        <div class="ob-field">
          <span class="ob-label">Фото и баннер</span>
          <div class="ob-media">
            <button type="button" class="btn sm" id="obAvatarPick">${icon('camera')}<span>Фото профиля</span></button>
            <button type="button" class="btn sm" id="obBannerPick">${icon('image')}<span>Баннер из галереи</span></button>
            <button type="button" class="btn ghost sm" id="obBannerClear" ${draft.bannerImg ? '' : 'disabled'}>Убрать баннер</button>
          </div>
          <div class="ob-banners" id="obBanners">${bannerOptionsHTML(draft.banner)}</div>
        </div>
        <p class="ob-error" id="obError" hidden></p>
        <div class="ob-actions">
          <button type="submit" class="btn primary ob-submit">Начать общение</button>
        </div>
        <p class="ob-hint">Профиль можно изменить позже: нажмите на свою аватарку → «Редактировать профиль».</p>
      </form>
      <input type="file" id="obAvatarFile" accept="image/*" hidden aria-label="Фото профиля">
      <input type="file" id="obBannerFile" accept="image/*" hidden aria-label="Баннер профиля">
    </div>`;
  }

  function showOnboarding() {
    if (document.getElementById('onboardScreen')) return;
    const screen = document.createElement('div');
    screen.id = 'onboardScreen';
    screen.className = 'ob-screen';
    screen.innerHTML = onboardingMarkup();
    document.body.append(screen);
    document.body.classList.add('ob-open');
    wireOnboarding(screen);
    try {
      if (location.search) history.replaceState({}, '', location.pathname);
    } catch (error) { /* ignore */ }
  }

  function hideOnboarding() {
    const screen = document.getElementById('onboardScreen');
    if (screen) screen.remove();
    document.body.classList.remove('ob-open');
  }

  function maybeOnboarding() {
    if (!cfg.profile || cfg.profile.onboarded !== false) return;
    showOnboarding();
  }

  async function checkUsername(username) {
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return { free: false, text: 'Только латиница, цифры и _ — от 3 до 24 символов', kind: '' };
    }
    try {
      const data = await api('/api/username?u=' + encodeURIComponent(username));
      if (data && data.available) return { free: true, text: 'Свободен', kind: 'ok' };
      return { free: false, text: 'Занят — выберите другой', kind: 'bad' };
    } catch (error) {
      return { free: true, text: '', kind: '' };
    }
  }

  function wireOnboarding(screen) {
    const person = (state.people && state.people[state.me]) || {};
    const draft = {
      name: person.name || '',
      username: person.username || '',
      bio: person.bio || '',
      birthday: (cfg.profile && cfg.profile.birthday) || '',
      grad: person.grad || 0,
      banner: person.banner || 'aurora',
      bannerImg: person.bannerImg || '',
      avatar: person.avatar || null
    };
    const q = (sel) => screen.querySelector(sel);
    const nameInput = q('#obNameInput');
    const userInput = q('#obUserInput');
    const bioInput = q('#obBio');
    const birthdayInput = q('#obBirthday');
    const note = q('#obUserNote');
    const error = q('#obError');
    const submit = q('.ob-submit');
    let usernameFree = false;
    let seq = 0;
    let timer = null;

    const paintAvatar = () => {
      q('#obAvatar').innerHTML = avatarHTML(draft, 88, {});
    };
    const paintText = () => {
      q('#obName').textContent = draft.name || 'Ваше имя';
      q('#obUser').textContent = '@' + (draft.username || 'username');
    };
    const paintBanner = () => {
      q('#obBanner').innerHTML = bannerHTML(draft.banner, '', draft.bannerImg);
      q('#obBannerClear').disabled = !draft.bannerImg;
    };
    const setError = (text) => {
      error.textContent = text || '';
      error.hidden = !text;
    };
    const verify = async () => {
      const mine = ++seq;
      const res = await checkUsername(draft.username);
      if (mine !== seq) return;
      usernameFree = res.free;
      note.textContent = res.text || 'Только латиница, цифры и _';
      note.className = 'ob-note' + (res.kind ? ' ' + res.kind : '');
    };

    nameInput.addEventListener('input', () => {
      draft.name = nameInput.value.trim();
      paintText();
    });
    bioInput.addEventListener('input', () => { draft.bio = bioInput.value; });
    birthdayInput.addEventListener('input', () => { draft.birthday = birthdayInput.value; });
    userInput.addEventListener('input', () => {
      const clean = cleanUsername(userInput.value);
      if (userInput.value !== clean) userInput.value = clean;
      draft.username = clean;
      paintText();
      clearTimeout(timer);
      timer = setTimeout(verify, 350);
      if (!clean) {
        note.textContent = 'Только латиница, цифры и _';
        note.className = 'ob-note';
      }
    });
    userInput.addEventListener('blur', () => {
      clearTimeout(timer);
      verify();
    });

    q('#obBanners').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-banner-pick]');
      if (!btn) return;
      draft.banner = btn.dataset.bannerPick;
      draft.bannerImg = '';
      q('#obBanners').querySelectorAll('[data-banner-pick]').forEach((other) => {
        const on = other === btn;
        other.classList.toggle('is-active', on);
        other.setAttribute('aria-pressed', String(on));
      });
      paintBanner();
    });

    const avatarFile = q('#obAvatarFile');
    q('#obAvatarPick').addEventListener('click', () => avatarFile.click());
    avatarFile.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        if (typeof toast === 'function') toast('Нужно фото', 'warn');
        return;
      }
      const cropped = await cropMedia(file, 'avatar');
      if (!cropped) return;
      draft.avatar = cropped;
      paintAvatar();
    });

    const bannerFile = q('#obBannerFile');
    q('#obBannerPick').addEventListener('click', () => bannerFile.click());
    q('#obBannerClear').addEventListener('click', () => {
      draft.bannerImg = '';
      paintBanner();
    });
    bannerFile.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        if (typeof toast === 'function') toast('Нужно фото', 'warn');
        return;
      }
      const cropped = await cropMedia(file, 'banner');
      if (!cropped) return;
      draft.bannerImg = cropped;
      paintBanner();
    });

    q('#obForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');
      const name = nameInput.value.trim();
      const username = cleanUsername(userInput.value);
      if (name.length < 2) {
        setError('Введите имя — минимум 2 символа');
        nameInput.focus();
        return;
      }
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        setError('Короткий адрес: 3–24 символа, только латиница, цифры и _');
        userInput.focus();
        return;
      }
      submit.disabled = true;
      const check = await checkUsername(username);
      if (!check.free) {
        submit.disabled = false;
        usernameFree = false;
        note.textContent = check.text;
        note.className = 'ob-note' + (check.kind ? ' ' + check.kind : '');
        setError('Этот короткий адрес занят — выберите другой');
        userInput.focus();
        return;
      }
      try {
        const data = await api('/api/profile', {
          method: 'PATCH',
          body: {
            name,
            username,
            bio: draft.bio.trim().slice(0, 190),
            birthday: draft.birthday || '',
            grad: draft.grad,
            banner: draft.banner,
            bannerImg: draft.bannerImg || '',
            avatar: draft.avatar,
            complete: true
          }
        });
        if (data && data.state) applyState(data.state);
        cfg.profile = { ...(cfg.profile || {}), onboarded: true };
        hideOnboarding();
        if (typeof renderAll === 'function') renderAll();
        if (typeof toast === 'function') toast('Профиль готов — можно писать', 'ok');
        refresh();
      } catch (err) {
        submit.disabled = false;
        setError(err.message || 'Не удалось сохранить профиль');
      }
    });

    verify();
    setTimeout(() => nameInput.focus(), 120);
  }

  function fire(promise, message) {
    return Promise.resolve(promise).catch((error) => {
      if (error && error.status === 401) return;
      if (typeof toast === 'function') toast(message || 'Не удалось сохранить на сервере', 'warn');
    });
  }

  async function uploadBlob(blob, name) {
    const res = await fetch('/api/upload?name=' + encodeURIComponent(name || 'file'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob
    });
    if (!res.ok) throw new Error('upload-failed');
    const data = await res.json();
    return data.url;
  }

  async function uploadDataUrl(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return uploadBlob(blob, name);
  }

  function bindExtras() {
    if (cfg.bound) return;
    cfg.bound = true;
    const findBtn = document.getElementById('btnFindPeople');
    if (findBtn) findBtn.addEventListener('click', () => openPeopleSearch(''));
    const newChat = document.querySelector('[data-new-chat]');
    if (newChat) newChat.addEventListener('click', (event) => event.preventDefault());
  }

  function personRowHTML(user) {
    const meta = typeof statusText === 'function' ? statusText(user) : '';
    const inChat = user.dmId ? '<span class="people-badge">в переписке</span>' : '';
    return `<button type="button" class="people-row" data-people-id="${esc(user.id)}">
      ${avatarHTML(user, 36, { status: true, border: 'var(--bg-3)' })}
      <span class="people-meta">
        <span class="people-name">${esc(user.name)}${inChat}</span>
        <span class="people-sub">@${esc(user.username)} · ${esc(meta)}</span>
      </span>
      <span class="people-action">${user.dmId ? 'Открыть' : 'Написать'}</span>
    </button>`;
  }

  function openPeopleSearch(initial = '') {
    if (!online()) {
      if (typeof openNewChat === 'function') openNewChat();
      return;
    }
    const html = `<div class="modal-pad">
      <h2 class="modal-title">Найти людей</h2>
      <p class="modal-sub">Поиск по короткому адресу @username или имени. Нажмите на человека — откроется личный чат.</p>
      <label class="search-field people-field">
        ${icon('search')}
        <input class="people-query" type="search" placeholder="username или имя" autocomplete="off" aria-label="Поиск людей" value="${esc(initial)}">
      </label>
      <div class="people-results"></div>
    </div>`;
    let seq = 0;
    let timer = null;
    openModal(html, {
      size: 'sm',
      label: 'Найти людей',
      onMount: (modal) => {
        const input = modal.querySelector('.people-query');
        const box = modal.querySelector('.people-results');
        const paint = (rows, query, loading) => {
          if (loading) {
            box.innerHTML = `<div class="people-empty">Ищем людей…</div>`;
            return;
          }
          if (rows === null) {
            box.innerHTML = `<div class="people-empty">Введите минимум 2 символа логина или имени.</div>`;
            return;
          }
          if (!rows.length) {
            box.innerHTML = `<div class="people-empty">Никого не нашли по запросу «${esc(query)}».<br>Проверьте @username — он виден в профиле.</div>`;
            return;
          }
          box.innerHTML = rows.map(personRowHTML).join('');
        };
        const search = async () => {
          const query = String(input.value || '').trim().replace(/^@/, '');
          if (query.length < 2) {
            paint(null, query, false);
            return;
          }
          const mine = ++seq;
          paint([], query, true);
          try {
            const data = await api('/api/users?q=' + encodeURIComponent(query));
            if (mine !== seq) return;
            paint(data.users || [], query, false);
          } catch (error) {
            if (mine !== seq) return;
            paint([], query, false);
          }
        };
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(search, 220);
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          clearTimeout(timer);
          search();
        });
        box.addEventListener('click', async (event) => {
          const row = event.target.closest('[data-people-id]');
          if (!row) return;
          try {
            const convId = await openDM(row.dataset.peopleId);
            if (convId) {
              closeAllModals();
              openConversation(convId);
            }
          } catch (error) {
            if (typeof toast === 'function') toast('Не удалось открыть переписку', 'warn');
          }
        });
        if (input.value.trim().length >= 2) search();
        else paint(null, '', false);
        setTimeout(() => input.focus(), 40);
      }
    });
  }

  async function openDM(personId) {
    const data = await api('/api/dm', { method: 'POST', body: { peerId: personId } });
    if (data && data.state) applyState(data.state);
    return data && data.convId;
  }

  async function handleDeepLink() {
    if (!online()) return;
    const groupMatch = location.pathname.match(/^\/g\/([a-z0-9-]{3,24})$/i);
    const userMatch = location.pathname.match(/^\/u\/([a-z0-9_]{3,24})$/i);
    try {
      if (groupMatch) {
        const data = await api('/api/groups/by-handle?handle=' + encodeURIComponent(groupMatch[1].toLowerCase()), { allow404: true });
        if (!data || !data.group) {
          if (typeof toast === 'function') toast('Группа по ссылке не найдена', 'warn');
          return;
        }
        if (data.group.isMember) {
          if (findConv(data.group.id)) openConversation(data.group.id);
          else refresh();
          return;
        }
        showGroupJoin(data.group);
      } else if (userMatch) {
        openPeopleSearch(userMatch[1]);
      }
    } catch (error) {
      if (typeof toast === 'function') toast('Ссылка не сработала', 'warn');
    }
  }

  function showGroupJoin(group) {
    const actionLabel = group.requested ? 'Заявка отправлена' : (group.access === 'open' ? 'Вступить в группу' : 'Подать заявку');
    const html = `<div class="modal-pad join-group">
      <div class="join-banner">${bannerHTML(group.banner, '', group.bannerImg)}</div>
      <h2 class="modal-title">${esc(group.name)}</h2>
      <p class="modal-sub">@${esc(group.handle)} · ${membersLabel(group.members)} · ${group.access === 'open' ? 'открытая группа' : 'закрытая группа'}</p>
      <p class="join-desc">${esc(group.desc || 'Описание пока не добавлено.')}</p>
      <div class="form-actions">
        <button type="button" class="btn" data-modal-close>Позже</button>
        <button type="button" class="btn primary" id="joinGroupBtn" ${group.requested ? 'disabled' : ''}>${actionLabel}</button>
      </div>
    </div>`;
    openModal(html, {
      size: 'sm',
      label: 'Вступление в группу',
      onMount: (modal) => {
        const btn = modal.querySelector('#joinGroupBtn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const data = await api('/api/conversations/' + group.id + '/join', { method: 'POST' });
            if (data && data.state) applyState(data.state);
            if (data && data.status === 'member') {
              closeAllModals();
              if (typeof renderAll === 'function') renderAll();
              openConversation(group.id);
              toast('Вы вступили в группу', 'ok');
            } else {
              closeAllModals();
              toast('Заявка отправлена владельцу и админам', 'ok');
            }
          } catch (error) {
            btn.disabled = false;
            toast(error.message || 'Не удалось вступить', 'warn');
          }
        });
      }
    });
  }

  async function start() {
    if (cfg.booted || cfg.booting) return;
    cfg.booting = true;
    let alive = false;
    try {
      const res = await fetch('/api/health', { credentials: 'same-origin' });
      alive = res.ok;
      if (res.ok) {
        const info = await res.json().catch(() => null);
        cfg.yandex = Boolean(info && info.yandex);
      }
    } catch (error) {
      alive = false;
    }
    if (!alive) {
      cfg.enabled = false;
      cfg.booting = false;
      if (location.protocol === 'file:') {
        bootApp();
        return;
      }
      showAuth('login');
      yandexNote('Сервер не отвечает. Проверьте соединение и обновите страницу — вход только через Яндекс ID.');
      return;
    }
    cfg.enabled = true;
    ensureAuth();
    try {
      const res = await fetch('/api/state', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        cfg.booting = false;
        if (data && data.state) enter(data.state);
        return;
      }
    } catch (error) {
      /* останется форма входа */
    }
    cfg.booting = false;
    showAuth('login');
  }

  function logout() {
    stopStream();
    cfg.online = false;
    cfg.booting = true;
    if (cfg.presenceTimer) clearInterval(cfg.presenceTimer);
    cfg.presenceTimer = null;
    try {
      localStorage.removeItem('youchat-v1');
      localStorage.removeItem('aurora-v1');
    } catch (error) { /* ignore */ }
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(() => {})
      .finally(() => { location.replace('/?auth=logout'); });
  }

  return {
    get enabled() { return cfg.enabled; },
    get online() { return online(); },
    get me() { return cfg.me; },
    start,
    refresh,
    applyState,
    openPeopleSearch,
    uploadBlob,
    uploadDataUrl,
    logout,
    api,
    fire,

    sendMessage(conv, message) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/messages`, {
        method: 'POST',
        body: { text: message.text || '', att: message.att || [], reply: message.reply || null, forwardedFrom: message.forwardedFrom || null }
      }).then((data) => {
        if (!data || !data.message) return;
        const local = conv.messages.find((m) => m.id === message.id);
        if (local) {
          const idx = conv.messages.indexOf(local);
          if (idx >= 0) conv.messages[idx] = data.message;
        }
      }).catch((error) => {
        const idx = conv.messages.findIndex((m) => m.id === message.id);
        if (idx >= 0) conv.messages.splice(idx, 1);
        const input = document.getElementById('composerInput');
        if (input && !input.value) {
          input.value = message.text || '';
          if (typeof resizeComposer === 'function') resizeComposer();
        }
        if (typeof renderMessages === 'function') renderMessages(conv);
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof toast === 'function') toast('Сообщение не отправлено — нет связи с сервером', 'warn');
        if (error && error.status === 401) return;
      });
    },

    editMessage(conv, msg, text) {
      if (!online()) return Promise.resolve();
      return fire(api(`/api/conversations/${conv.id}/messages/${msg.id}`, { method: 'PATCH', body: { text } }), 'Не удалось изменить сообщение');
    },

    deleteMessages(conv, msgs) {
      if (!online() || !msgs.length) return Promise.resolve();
      const ids = msgs.filter((m) => !m.sys).map((m) => m.id);
      if (!ids.length) return Promise.resolve();
      return fire(api(`/api/conversations/${conv.id}/messages/delete`, { method: 'POST', body: { ids } }), 'Не удалось удалить сообщение');
    },

    react(conv, msg, emoji) {
      if (!online()) return Promise.resolve();
      return fire(api(`/api/conversations/${conv.id}/messages/${msg.id}/reaction`, { method: 'POST', body: { emoji } }), 'Не удалось поставить реакцию');
    },

    pinMessage(conv, msg) {
      if (!online()) return Promise.resolve();
      return fire(api(`/api/conversations/${conv.id}/messages/${msg.id}/pin`, { method: 'POST' }), 'Не удалось закрепить');
    },

    pinConversation(conv, pinned) {
      if (!online()) return Promise.resolve();
      return fire(api(`/api/conversations/${conv.id}/pin`, { method: 'POST', body: { pinned: Boolean(pinned) } }), 'Не удалось закрепить беседу');
    },

    read(conv) {
      if (!online() || !conv) return;
      api(`/api/conversations/${conv.id}/read`, { method: 'POST' }).catch(() => {});
    },

    leave(conv) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/leave`, { method: 'DELETE' })
        .then(() => refresh())
        .catch((error) => { if (error.status !== 401) toast(error.message || 'Не удалось выйти из беседы', 'warn'); });
    },

    createGroup(payload) {
      return api('/api/conversations', { method: 'POST', body: payload }).then((data) => {
        if (data && data.state) applyState(data.state);
        return data && data.convId;
      });
    },

    updateGroup(conv, patch) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}`, { method: 'PATCH', body: patch }).then((data) => {
        if (data && data.state) applyState(data.state);
      });
    },

    addMembers(conv, ids) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/members`, { method: 'POST', body: { ids } }).then((data) => {
        if (data && data.state) applyState(data.state);
      });
    },

    kickMember(conv, personId) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/members/${personId}`, { method: 'DELETE' }).then((data) => {
        if (data && data.state) applyState(data.state);
      });
    },

    setRole(conv, personId, role) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/members/${personId}/role`, { method: 'POST', body: { role } }).then((data) => {
        if (data && data.state) applyState(data.state);
      });
    },

    transfer(conv, personId) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/transfer`, { method: 'POST', body: { userId: personId } }).then((data) => {
        if (data && data.state) applyState(data.state);
      });
    },

    decideRequest(conv, reqId, accept) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/requests/${reqId}`, { method: 'POST', body: { accept: Boolean(accept) } }).then((data) => {
        if (data && data.state) applyState(data.state);
      });
    },

    acceptAllRequests(conv) {
      if (!online()) return Promise.resolve();
      return api(`/api/conversations/${conv.id}/requests/accept-all`, { method: 'POST' }).then((data) => {
        if (data && data.state) applyState(data.state);
      });
    },

    saveProfile(patch) {
      if (!online()) return Promise.resolve(null);
      return api('/api/profile', { method: 'PATCH', body: patch }).then((data) => {
        if (data && data.state) applyState(data.state);
        return data && data.person;
      });
    },

    openDM,

    openNewChat() {
      openPeopleSearch('');
    }
  };
})();
