'use strict';

const ui = {
  view: 'all',
  filter: '',
  msgQuery: '',
  replyTo: null,
  pending: [],
  emojiReady: false
};

let emojiReady = false;
let suppressPopover = false;

function scrollBottom(smooth = false) {
  const scroller = $('#chatScroll');
  if (!scroller) return;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
}

function groupOnlineCount(conv) {
  return conv.members.filter((id) => ['online', 'idle'].includes(person(id).status)).length;
}

function renderAll() {
  if (!state.conversations.length) state.activeId = null;
  if (state.activeId && !findConv(state.activeId)) state.activeId = state.conversations[0]?.id || null;
  renderRail();
  renderSidebar();
  renderChat();
  renderMe();
  refreshTitle();
}

function renderMe() {
  const p = me();
  $('#meAvatar').innerHTML = avatarHTML(p, 30);
  $('#meName').textContent = p.name;
  $('#meStatus').textContent = p.custom || statusText(p);
  $('#btnMic').setAttribute('aria-pressed', state.prefs.micMuted ? 'false' : 'true');
  $('#btnSound').setAttribute('aria-pressed', state.prefs.soundOff ? 'false' : 'true');
}

function renderRail() {
  $$('.rail-btn[data-view]').forEach((btn) => {
    const on = ui.view === btn.dataset.view;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const groups = state.conversations.filter((c) => c.type === 'group');
  $('#railShortcuts').innerHTML = groups.map((conv) => {
    const grad = GRADS[(conv.grad || 0) % GRADS.length];
    return `<button class="rail-shortcut ${conv.id === state.activeId ? 'is-active' : ''}" data-rail-conv="${conv.id}"
      style="--g1:${grad[0]};--g2:${grad[1]}" aria-label="Открыть группу «${esc(conv.name)}»" data-tip="${esc(conv.name)}">${esc(conv.icon || monogram(conv.name))}</button>`;
  }).join('');
}

function lastTs(conv) {
  const msg = lastMessage(conv);
  return msg ? msg.t : 0;
}

function matchConv(conv, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const name = convTitle(conv).toLowerCase();
  const handle = String(conv.handle || '').toLowerCase();
  const user = conv.type === 'dm' ? person(conv.peer).username.toLowerCase() : '';
  return name.includes(q) || handle.includes(q) || user.includes(q);
}

function convItemHTML(conv) {
  const msg = lastMessage(conv);
  const grp = conv.type === 'group';
  const id = conv.id;
  const active = state.activeId === id;
  const role = grp ? conv.roles?.[state.me] : null;
  const preview = previewOf(conv);
  const time = msg ? fmtShort(msg.t) : '';
  const badge = conv.unread ? `<span class="conv-badge">${conv.unread > 99 ? '99+' : conv.unread}</span>` : '';
  const pin = conv.pinned ? `<span class="conv-pin" title="Закреплено">${icon('pin')}</span>` : '';
  return `<div class="conv ${active ? 'is-active' : ''} ${conv.unread ? 'unread' : ''}" role="button" tabindex="0" data-conv="${id}" aria-label="${esc(convTitle(conv))}${conv.unread ? `, ${conv.unread} непрочитанных` : ''}">
    <span class="conv-av">${convAvatarHTML(conv, 40, { status: !grp, border: 'var(--bg-1)' })}</span>
    <span class="conv-main">
      <span class="conv-row">
        <span class="conv-name">${esc(convTitle(conv))}</span>
        ${pin}
        <span class="conv-time">${time}</span>
      </span>
      <span class="conv-row">
        <span class="conv-prev">${esc(preview)}</span>
        ${badge}
      </span>
    </span>
    <button type="button" class="conv-more" data-conv-menu="${id}" aria-label="Действия с беседой «${esc(convTitle(conv))}»">${icon('more')}</button>
  </div>`;
}

function sectionHTML(label, list) {
  if (!list.length) return '';
  return `<div class="side-section">
    <div class="side-label"><span>${esc(label)}</span><span>${list.length}</span></div>
    ${list.map(convItemHTML).join('')}
  </div>`;
}

function renderSidebar() {
  const query = ui.filter.trim();
  const all = state.conversations.filter((c) => matchConv(c, query));
  const dms = all.filter((c) => c.type === 'dm').sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (lastTs(b) - lastTs(a)));
  const groups = all.filter((c) => c.type === 'group').sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (lastTs(b) - lastTs(a)));
  let html = '';
  if (ui.view !== 'groups') html += sectionHTML('Личные сообщения', dms);
  html += sectionHTML('Группы', groups);
  if (!html) {
    html = `<div class="empty" style="padding:34px 16px">
      <span class="empty-ico">${query ? icon('search') : icon('dm')}</span>
      <h3>${query ? 'Ничего не найдено' : 'Пока нет бесед'}</h3>
      <p>${query ? `По запросу «${esc(query)}» бесед нет.` : 'Создайте группу или напишите человеку — начните с любого.'}</p>
      <div class="empty-actions">
        <button class="btn sm primary" data-create-group>${icon('plus')}<span>Новая группа</span></button>
        <button class="btn sm" data-new-chat>${icon('dm')}<span>Переписка</span></button>
      </div>
    </div>`;
  }
  $('#convList').innerHTML = html;
}

function roleBadge(role) {
  if (role === 'owner') return `<span class="msg-role">Основатель</span>`;
  if (role === 'admin') return `<span class="msg-role">Админ</span>`;
  return '';
}

function formatText(text) {
  let out = esc(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])@([a-zA-Z0-9_]{2,32})/g, (match, pre, user) => `${pre}<span class="mention">@${user}</span>`);
  out = out.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

function videoHTML(a) {
  const poster = posterSrc(a);
  return `<button type="button" class="att-video" data-media-aid="${a.aid}" aria-label="Воспроизвести видео «${esc(a.title || 'Видео')}»">
    <img src="${poster}" alt="">
    <span class="play-circle">${icon('play')}</span>
    <span class="vname">${esc(a.title || 'Видео')}</span>
    <span class="dur">${fmtDur(a.dur || 12)}</span>
  </button>`;
}

function attachmentHTML(m) {
  const atts = m.att || [];
  if (!atts.length) return '';
  const imgs = atts.filter((a) => a.k === 'img');
  const vids = atts.filter((a) => a.k === 'vid');
  let html = '<div class="att">';
  if (imgs.length) {
    const count = imgs.length;
    if (count === 1) {
      const a = imgs[0];
      html += `<button type="button" class="att-item single" style="--ar:${a.w || 4}/${a.h || 3}" data-media-aid="${a.aid}" aria-label="Открыть изображение «${esc(a.title || 'Фото')}»">
        <img src="${mediaSrc(a, 1000, 760)}" alt="${esc(a.title || 'Изображение')}">
      </button>`;
    } else {
      const shown = count > 3 ? imgs.slice(0, 3) : imgs;
      const cls = count === 2 ? 'two' : 'three';
      html += `<div class="att-row ${cls}">` + shown.map((a, i) => `
        <button type="button" class="att-item" data-media-aid="${a.aid}" aria-label="Открыть изображение «${esc(a.title || 'Фото')}»">
          <img src="${mediaSrc(a, 520, 420)}" alt="${esc(a.title || 'Изображение')}">
          ${count > 3 && i === 2 ? `<span class="att-more">+${count - 3}</span>` : ''}
        </button>`).join('') + '</div>';
    }
  }
  vids.forEach((a) => { html += videoHTML(a); });
  atts.filter((a) => a.k === 'voice').forEach((a) => {
    if (!a.src) {
      html += `<div class="voice"><span class="voice-dur">Запись недоступна</span></div>`;
      return;
    }
    const bars = Array.from({ length: 22 }, (_, i) => {
      const h = 24 + Math.round(52 * Math.abs(Math.sin((i + 1) * 1.7 + (a.dur || 1))) );
      return `<i style="--h:${h}%"></i>`;
    }).join('');
    html += `<div class="voice">
      <button type="button" class="voice-btn" data-voice-btn aria-label="Воспроизвести голосовое">${icon('play')}</button>
      <span class="wave">${bars}</span>
      <span class="voice-dur">${fmtDur(a.dur || 0)}</span>
      <audio preload="metadata" src="${a.src}"></audio>
    </div>`;
  });
  atts.filter((a) => a.k === 'note').forEach((a) => {
    if (!a.src) {
      html += `<div class="note-lost">Кружок недоступен после перезагрузки</div>`;
      return;
    }
    html += `<button type="button" class="note is-paused ${a.mirror ? 'is-mirror' : ''}" data-note-aid="${a.aid}" aria-label="Кружок, ${fmtDur(a.dur || 0)}">
      <video src="${a.src}" playsinline loop preload="metadata"></video>
      <span class="note-toggle">${icon('play')}</span>
      <span class="note-dur">${fmtDur(a.dur || 0)}</span>
    </button>`;
  });
  return html + '</div>';
}

function messageHTML(m, conv, prev) {
  if (m.sys) {
    return `<div class="sys">${icon('sparkle')}<span>${esc(m.sys)}</span></div>`;
  }
  if (m.deleted) {
    return `<div class="msg is-deleted" data-msg="${m.id}">
      <div class="msg-gutter"></div>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-time">${fmtTime(m.t)}</span></div>
        <div class="msg-deleted">Сообщение удалено</div>
      </div>
    </div>`;
  }
  const author = person(m.author);
  const role = conv.type === 'group' ? conv.roles?.[m.author] : null;
  const grouped = prev && !prev.sys && prev.author === m.author && (m.t - prev.t) < 6 * 60000 && !m.reply;
  const mine = m.author === state.me;
  const reply = m.reply ? conv.messages.find((x) => x.id === m.reply) : null;
  const isMention = !mine && typeof m.text === 'string' && new RegExp('@' + (me().username || '-') + '\\b', 'i').test(m.text);
  const reacts = Object.entries(m.react || {}).filter((entry) => entry[1] && entry[1].length);
  const picked = Boolean(ui.sel && ui.sel.has(m.id));
  let html = `<div class="msg ${grouped ? 'is-grouped' : 'is-first'} ${isMention ? 'is-mention' : ''} ${picked ? 'is-picked' : ''} ${ui.sel ? 'is-picking' : ''}" data-msg="${m.id}">
    ${ui.sel ? `<span class="pick-check">${picked ? icon('check') : ''}</span>` : ''}
    <div class="msg-gutter">${grouped
      ? `<time>${fmtTime(m.t)}</time>`
      : `<button type="button" class="msg-avatar" data-profile="${author.id}" aria-label="Профиль ${esc(author.name)}">${avatarHTML(author, 40)}</button>`}
    </div>
    <div class="msg-body">`;
  if (m.forwardedFrom) {
    html += `<div class="fwd-label">${icon('forward')}<span>Переслано от ${esc(m.forwardedFrom)}</span></div>`;
  }
  if (!grouped) {
    html += `<div class="msg-meta">
      <button type="button" class="msg-author" data-profile="${author.id}" style="--name:${esc(author.accent)}">${esc(author.name)}</button>
      <span class="msg-time">${fmtTime(m.t)}</span>
      ${m.editedAt ? '<span class="msg-edited">изм.</span>' : ''}
      ${roleBadge(role)}
      ${m.pinned ? `<span class="msg-time" title="Закреплено">${icon('pin')}</span>` : ''}
    </div>`;
  }
  if (reply) {
    const rp = person(reply.author);
    const snippet = reply.text || (reply.att?.length ? (reply.att[0].k === 'vid' ? 'Видео' : 'Фото') : 'Сообщение');
    html += `<button type="button" class="msg-reply" data-jump="${reply.id}">
      <b>${esc(rp.name.split(' ')[0])}</b><span>${esc(snippet.slice(0, 110))}</span>
    </button>`;
  }
  if (m.text) html += `<div class="msg-text">${formatText(m.text)}</div>`;
  html += attachmentHTML(m);
  if (reacts.length) {
    html += '<div class="reactions">' + reacts.map(([emoji, users]) => `
      <button type="button" class="react ${users.includes(state.me) ? 'is-mine' : ''}" data-react="${esc(emoji)}" data-msg="${m.id}"
        aria-pressed="${users.includes(state.me)}" aria-label="Реакция ${esc(emoji)}, ${users.length}">${esc(emoji)}<b>${users.length}</b></button>`).join('') + '</div>';
  }
  html += `</div>
    <div class="msg-tools">
      <button type="button" class="icon-btn" data-react-add="${m.id}" aria-label="Добавить реакцию">${icon('smile')}</button>
      <button type="button" class="icon-btn" data-reply="${m.id}" aria-label="Ответить">${icon('reply')}</button>
      <button type="button" class="icon-btn" data-msg-more="${m.id}" aria-label="Действия с сообщением">${icon('more')}</button>
    </div>
  </div>`;
  return html;
}

function renderMessages(conv) {
  const box = $('#messages');
  if (!conv) {
    box.innerHTML = `<div class="empty">
      <span class="empty-ico">${icon('sparkle')}</span>
      <h3>Начните с беседы</h3>
      <p>Выберите переписку слева, напишите человеку или создайте группу.</p>
      <div class="empty-actions">
        <button class="btn primary" data-create-group>${icon('plus')}<span>Создать группу</span></button>
        <button class="btn" data-new-chat>${icon('dm')}<span>Начать переписку</span></button>
      </div>
    </div>`;
    $('#msgSearchCount').textContent = '';
    return;
  }
  let list = conv.messages.filter((m) => !(m.hiddenFor || []).includes(state.me));
  const q = ui.msgQuery.trim().toLowerCase();
  if (q) {
    list = list.filter((m) => {
      if (m.sys) return false;
      return (m.text || '').toLowerCase().includes(q)
        || person(m.author).name.toLowerCase().includes(q)
        || (m.att || []).some((a) => String(a.title || '').toLowerCase().includes(q));
    });
  }
  const found = q ? list.length : 0;
  $('#msgSearchCount').textContent = q ? `${found}` : '';
  let html = '';
  if (q) {
    html += `<div class="search-info">${icon('search')}<span>Найдено: <b>${found}</b> по запросу «${esc(ui.msgQuery.trim())}»</span><button type="button" class="btn sm ghost" data-clear-search>Сбросить</button></div>`;
  }
  if (!list.length) {
    html += `<div class="empty">
      <span class="empty-ico">${q ? icon('search') : icon('sparkle')}</span>
      <h3>${q ? 'Совпадений нет' : 'Пока тихо'}</h3>
      <p>${q ? 'Попробуйте другое слово или имя участника.' : 'Напишите первое сообщение — оно сразу появится здесь.'}</p>
    </div>`;
    box.innerHTML = html;
    return;
  }
  let lastDay = '';
  let prev = null;
  list.forEach((m) => {
    const dayKey = new Date(m.t).toDateString();
    if (dayKey !== lastDay) {
      html += `<div class="day">${fmtDay(m.t)}</div>`;
      lastDay = dayKey;
      prev = null;
    }
    html += messageHTML(m, conv, prev);
    prev = m.sys ? null : m;
  });
  box.innerHTML = html;
}

function renderIntro(conv) {
  const intro = $('#chatIntro');
  if (!conv) {
    intro.innerHTML = '';
    return;
  }
  const media = collectMedia(conv);
  if (conv.type === 'group') {
    const owner = conv.members.find((id) => conv.roles?.[id] === 'owner');
    intro.innerHTML = `
      <div class="intro-banner">${bannerHTML(conv.banner, '', conv.bannerImg)}</div>
      <div class="intro-main">
        <span class="intro-av">${groupAvatarHTML(conv, 56)}</span>
        <div class="intro-info">
          <h2 class="intro-name">${esc(conv.name)}<span class="lock" title="Приватная группа">${icon('lock')}</span></h2>
          <div class="intro-meta">
            <span><b>${conv.members.length}</b> ${pluralMembers(conv.members.length)}</span>
            <span><b>${groupOnlineCount(conv)}</b> в сети</span>
            <span>Медиа: <b>${media.length}</b></span>
            <span>Создана ${fmtJoined(conv.created || Date.now())}</span>
          </div>
        </div>
        <div class="intro-actions">
          <button type="button" class="btn sm primary" data-open-group="${conv.id}">${icon('info')}<span>Карточка группы</span></button>
          <button type="button" class="btn sm" data-open-media>${icon('grid')}<span>Медиа</span></button>
        </div>
      </div>
      <p class="intro-desc">${esc(conv.desc || '')}</p>`;
  } else {
    const p = person(conv.peer);
    intro.innerHTML = `
      <div class="intro-banner">${bannerHTML(p.banner, '', p.bannerImg)}</div>
      <div class="intro-main">
        <span class="intro-av">${avatarHTML(p, 56, { status: true, border: 'var(--bg-3)' })}</span>
        <div class="intro-info">
          <h2 class="intro-name">${esc(p.name)}</h2>
          <div class="intro-meta">
            <span class="status-pill"><span class="dot" data-st="${p.status}"></span>${statusText(p)}</span>
            <span>@${esc(p.username)}</span>
            <span>Медиа: <b>${media.length}</b></span>
            <span>В YouChat с ${fmtJoined(p.joined || Date.now())}</span>
          </div>
        </div>
        <div class="intro-actions">
          <button type="button" class="btn sm primary" data-open-profile="${p.id}">${icon('users')}<span>Профиль</span></button>
          <button type="button" class="btn sm" data-open-media>${icon('grid')}<span>Медиа</span></button>
        </div>
      </div>
      <p class="intro-desc">${esc(p.bio || '')}</p>`;
  }
}

function renderChatHeader(conv) {
  const btn = $('#chatTitleBtn');
  if (!conv) {
    $('#chatName').textContent = 'YouChat';
    $('#chatSub').textContent = 'Нет активной беседы';
    $('#chatAvatar').innerHTML = '';
    $('#composerArea').hidden = true;
    btn.disabled = true;
    $('#chat').setAttribute('aria-label', 'YouChat');
    return;
  }
  btn.disabled = false;
  $('#composerArea').hidden = false;
  $('#chatName').textContent = convTitle(conv);
  if (conv.type === 'group') {
    $('#chatSub').textContent = `${membersLabel(conv.members.length)} · ${groupOnlineCount(conv)} в сети`;
    $('#chatAvatar').innerHTML = groupAvatarHTML(conv, 30);
    $('#chat').setAttribute('aria-label', `Группа ${conv.name}`);
  } else {
    const p = person(conv.peer);
    $('#chatSub').textContent = statusText(p);
    $('#chatAvatar').innerHTML = avatarHTML(p, 30, { status: true, border: 'var(--bg-2)' });
    $('#chat').setAttribute('aria-label', `Переписка с ${p.name}`);
  }
  $('#composerInput').placeholder = 'Написать сообщение';
}

function renderMembers(conv) {
  const panel = $('#membersPanel');
  panel.classList.toggle('is-hidden', !state.prefs.membersOpen);
  $('#btnMembers').setAttribute('aria-pressed', String(Boolean(state.prefs.membersOpen)));
  if (!conv) {
    panel.innerHTML = '';
    return;
  }
  if (conv.type === 'dm') {
    const p = person(conv.peer);
    const media = collectMedia(conv);
    panel.innerHTML = `
      <div class="mem-head"><span>Профиль</span><button type="button" class="icon-btn sm" data-close-members aria-label="Скрыть панель">${icon('close')}</button></div>
      <div class="mem-scroll">
        <div class="dm-card">
          <div class="dm-card-banner">${bannerHTML(p.banner, '', p.bannerImg)}</div>
          <div class="dm-card-body">
            <span class="dm-card-av">${avatarHTML(p, 58, { status: true, border: 'var(--bg-3)' })}</span>
            <h3 class="dm-card-name">${esc(p.name)}</h3>
            <div class="dm-card-status"><span class="dot" data-st="${p.status}"></span>${statusText(p)}</div>
            <p class="dm-card-bio">${esc(p.bio || '')}</p>
            <div class="dm-actions">
              <button type="button" class="btn sm" data-open-profile="${p.id}">${icon('users')}<span>Профиль</span></button>
              <button type="button" class="btn sm" data-open-media>${icon('grid')}<span>Медиа</span></button>
            </div>
            <div class="dm-media-label">Медиа ${media.length ? '· ' + media.length : ''}</div>
            <div class="media-strip">${media.slice(0, 6).map((item) => `
              <button type="button" data-media-aid="${item.a.aid}" aria-label="Открыть ${esc(item.a.title || 'медиа')}">
                <img src="${posterSrc(item.a)}" alt="">
                ${item.a.k === 'vid' ? `<span class="vdot">${icon('play')}</span>` : ''}
              </button>`).join('')}</div>
            ${media.length ? '' : '<p class="dm-card-bio">Пока нет фото и видео.</p>'}
          </div>
        </div>
      </div>`;
    return;
  }
  const order = ['owner', 'admin', 'member'];
  const labels = { owner: 'Основатель', admin: 'Админы', member: 'Участники' };
  const sorted = (role) => conv.members
    .filter((id) => (conv.roles?.[id] || 'member') === role)
    .map((id) => person(id))
    .sort((a, b) => {
      const rank = { online: 0, idle: 1, dnd: 2, offline: 3 };
      return (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || a.name.localeCompare(b.name, 'ru');
    });
  let rows = '';
  order.forEach((role) => {
    const people = sorted(role);
    if (!people.length) return;
    rows += `<div class="mem-label">${labels[role]} <span>${people.length}</span></div>`;
    rows += people.map((p) => {
      const ownerRole = role === 'owner';
      const adminRole = role === 'admin';
      const canMenu = canManageMember(conv, p.id);
      return `<div class="member-wrap">
        <button type="button" class="member" data-profile="${p.id}" aria-label="Профиль ${esc(p.name)}">
          ${avatarHTML(p, 32, { status: true, border: 'var(--bg-1)' })}
          <span class="member-meta">
            <span class="member-name">${esc(p.name)}${ownerRole ? `<span class="member-badge owner">${icon('crown')}</span>` : adminRole ? `<span class="member-badge">${icon('shield')}</span>` : ''}</span>
            <span class="member-sub">${esc(p.custom || statusText(p))}</span>
          </span>
        </button>
        ${canMenu ? `<button type="button" class="member-menu-btn" data-member-menu="${conv.id}|${p.id}" aria-label="Действия с участником">${icon('more')}</button>` : ''}
      </div>`;
    }).join('');
  });
  panel.innerHTML = `<div class="mem-head"><span>Участники</span><span>${conv.members.length}</span></div><div class="mem-scroll">${rows}</div>`;
}

function renderChat() {
  const conv = activeConv() || null;
  renderChatHeader(conv);
  renderIntro(conv);
  renderMessages(conv);
  renderMembers(conv);
  renderReply();
  renderPending();
  if (typeof renderSelectionBar === 'function') renderSelectionBar();
  if (typeof renderEditChip === 'function') renderEditChip();
  if (conv) resizeComposer();
}

function renderReply() {
  const chip = $('#replyChip');
  const conv = activeConv();
  if (!ui.replyTo || !conv) {
    chip.hidden = true;
    chip.innerHTML = '';
    return;
  }
  const msg = conv.messages.find((m) => m.id === ui.replyTo);
  if (!msg) {
    ui.replyTo = null;
    chip.hidden = true;
    return;
  }
  const author = person(msg.author);
  const snippet = msg.text || (msg.att?.length ? (msg.att[0].k === 'vid' ? 'видео' : 'фото') : 'сообщение');
  chip.hidden = false;
  chip.innerHTML = `${icon('reply')}<span>Ответ <b>${esc(author.name)}</b> · ${esc(snippet.slice(0, 120))}</span>
    <button type="button" class="icon-btn xs" data-reply-cancel aria-label="Отменить ответ">${icon('close')}</button>`;
}

function renderPending() {
  const box = $('#pending');
  if (!ui.pending.length) {
    box.innerHTML = '';
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = ui.pending.map((a) => `
    <div class="pend">
      ${a.k === 'img'
        ? `<img src="${a.src}" alt="">`
        : `<video src="${a.src}" muted preload="metadata" aria-hidden="true"></video>`}
      <span class="kind">${a.k === 'img' ? 'фото' : 'видео'}</span>
      <button type="button" class="rm" data-pend-rm="${a.aid}" aria-label="Убрать вложение">×</button>
    </div>`).join('');
}

function resizeComposer() {
  const input = $('#composerInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(168, Math.max(22, input.scrollHeight)) + 'px';
}

function refreshTitle() {
  titleBadge();
}

function setView(view) {
  ui.view = view;
  renderRail();
  renderSidebar();
}

function openConversation(id, opts = {}) {
  const conv = findConv(id);
  if (!conv) return;
  state.activeId = id;
  conv.unread = 0;
  ui.msgQuery = '';
  ui.replyTo = null;
  ui.pending = [];
  ui.sel = null;
  ui.editing = null;
  closePopover();
  closeEmojiPicker();
  const searchWrap = $('#msgSearchWrap');
  if (searchWrap) searchWrap.hidden = true;
  $('.chat-head')?.classList.remove('searching');
  $('#msgSearch').value = '';
  $('#composerInput').value = '';
  renderAll();
  requestAnimationFrame(() => scrollBottom(false));
  persist();
  if (typeof NET !== 'undefined' && NET.online) NET.read(conv);
  if (window.innerWidth <= 960 || opts.mobile) $('#app').classList.add('chat-open');
}

function markRead(conv) {
  if (!conv || !conv.unread) return;
  conv.unread = 0;
  renderSidebar();
  refreshTitle();
  persist();
  if (typeof NET !== 'undefined' && NET.online) NET.read(conv);
}

function sendCurrent() {
  const conv = activeConv();
  if (!conv) return;
  const input = $('#composerInput');
  const text = input.value.trim();
  if (ui.editing) {
    if (!text) { toast('Текст не может быть пустым', 'warn'); return; }
    commitEdit(text);
    return;
  }
  const atts = ui.pending.slice();
  if (!text && !atts.length) return;
  const message = {
    id: uid('m'), author: state.me, t: Date.now(), text, att: atts,
    react: {}, reply: ui.replyTo || null, pinned: false
  };
  conv.messages.push(message);
  ui.pending = [];
  ui.replyTo = null;
  input.value = '';
  resizeComposer();
  renderSidebar();
  renderIntro(conv);
  renderMessages(conv);
  renderPending();
  renderReply();
  renderMembers(conv);
  requestAnimationFrame(() => scrollBottom(true));
  closePopover();
  closeEmojiPicker();
  persist();
  if (typeof NET !== 'undefined' && NET.online) NET.sendMessage(conv, message);
  input.focus();
}

function toggleReaction(msgId, emoji) {
  const conv = activeConv();
  if (!conv) return;
  const msg = conv.messages.find((m) => m.id === msgId);
  if (!msg) return;
  msg.react = msg.react || {};
  const list = msg.react[emoji] || [];
  const at = list.indexOf(state.me);
  if (at >= 0) list.splice(at, 1);
  else list.push(state.me);
  if (list.length) msg.react[emoji] = list;
  else delete msg.react[emoji];
  renderMessages(conv);
  persist();
  if (typeof NET !== 'undefined' && NET.online) NET.react(conv, msg, emoji);
}

function openQuickReacts(anchor, msgId) {
  const content = `<div class="emoji-menu">${QUICK_REACTS.map((e) => `<button type="button" data-quick-react="${esc(e)}" aria-label="Реакция ${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
  openPopover(anchor, content, {
    kind: 'menu',
    onMount: (pop) => {
      $$('[data-quick-react]', pop).forEach((btn) => {
        btn.addEventListener('click', () => {
          toggleReaction(msgId, btn.dataset.quickReact);
          closePopover();
        });
      });
    }
  });
}

function openMessageMenu(anchor, msgId) {
  const conv = activeConv();
  const msg = conv?.messages.find((m) => m.id === msgId);
  if (!conv || !msg || msg.deleted) return;
  const items = [
    { id: 'reply', label: 'Ответить', icon: 'reply', onClick: () => setReply(msgId) },
    { id: 'react', label: 'Реакция', icon: 'smile', onClick: () => openQuickReacts(anchor, msgId) },
    { id: 'forward', label: 'Переслать', icon: 'forward', onClick: () => forwardMessages([msg]) },
    { id: 'select', label: 'Выбрать сообщения', icon: 'select', onClick: () => startSelection(msgId) },
    'sep',
    { id: 'copy', label: 'Копировать текст', icon: 'copy', onClick: () => copyText(msg.text || msg.att?.[0]?.title || '') }
  ];
  if (conv.type === 'group') {
    items.push({ id: 'link', label: 'Ссылка на сообщение', icon: 'link', onClick: () => copyText(messageLink(conv, msg)) });
  }
  if (canEditMessage(msg)) {
    const label = msg.text ? 'Изменить текст' : ((msg.att || []).length ? 'Добавить текст' : 'Изменить');
    items.push({ id: 'edit', label, icon: 'edit', onClick: () => startEdit(msgId) });
  }
  const voiceAtt = (msg.att || []).find((a) => a.k === 'voice');
  const noteAtt = (msg.att || []).find((a) => a.k === 'note');
  if (voiceAtt) {
    items.push({
      id: 'rerecord-voice', label: 'Перезаписать голосовое', icon: 'mic',
      onClick: () => { closePopover(); startRecording('voice', { replaceId: msg.id }); }
    });
  }
  if (noteAtt) {
    items.push({
      id: 'rerecord-note', label: 'Перезаписать кружок', icon: 'camera',
      onClick: () => { closePopover(); startRecording('note', { replaceId: msg.id }); }
    });
  }
  items.push({
    id: 'pin', label: msg.pinned ? 'Открепить' : 'Закрепить', icon: 'pin',
    onClick: () => togglePin(msgId)
  });
  items.push('sep');
  const ownOrModerated = canDeleteForAll(conv, msg);
  items.push({
    id: 'delete',
    label: ownOrModerated ? 'Удалить у всех' : 'Удалить у себя',
    icon: 'trash',
    danger: true,
    onClick: () => confirmDeleteMessages([msg])
  });
  openMenu(anchor, items);
}

function togglePin(msgId) {
  const conv = activeConv();
  if (!conv) return;
  const msg = conv.messages.find((m) => m.id === msgId);
  if (!msg) return;
  msg.pinned = !msg.pinned;
  conv.pinnedMsgs = conv.pinnedMsgs || [];
  if (msg.pinned) {
    if (!conv.pinnedMsgs.includes(msgId)) conv.pinnedMsgs.push(msgId);
  } else {
    conv.pinnedMsgs = conv.pinnedMsgs.filter((id) => id !== msgId);
  }
  renderMessages(conv);
  persist();
  if (typeof NET !== 'undefined' && NET.online) NET.pinMessage(conv, msg);
  toast(msg.pinned ? 'Сообщение закреплено' : 'Сообщение откреплено', 'ok');
}

function setReply(msgId) {
  ui.replyTo = msgId;
  renderReply();
  $('#composerInput').focus();
}

function openConversationMenu(conv, anchor) {
  const items = [];
  if (conv.unread) items.push({ id: 'read', label: 'Отметить прочитанным', icon: 'check', onClick: () => markRead(conv) });
  items.push({
    id: 'pin', label: conv.pinned ? 'Открепить беседу' : 'Закрепить беседу', icon: 'pin',
    onClick: () => {
      conv.pinned = !conv.pinned;
      renderSidebar();
      persist();
      if (typeof NET !== 'undefined' && NET.online) NET.pinConversation(conv, conv.pinned);
      toast(conv.pinned ? 'Беседа закреплена' : 'Беседа откреплена', 'ok');
    }
  });
  items.push('sep');
  if (!(conv.type === 'group' && isOwner(conv))) items.push({
    id: 'remove', label: conv.type === 'group' ? 'Покинуть группу' : 'Удалить переписку', icon: 'logout', danger: true,
    onClick: () => {
      openConfirm({
        title: conv.type === 'group' ? `Покинуть «${conv.name}»?` : 'Удалить переписку?',
        text: conv.type === 'group'
          ? 'Группа исчезнет из вашего списка вместе с историей. Вернуть её можно только сбросом демо-данных.'
          : 'Переписка и все вложения будут удалены с этого устройства.',
        confirmLabel: conv.type === 'group' ? 'Покинуть' : 'Удалить',
        danger: true,
        onConfirm: () => removeConversation(conv)
      });
    }
  });
  openMenu(anchor, items);
}

function removeConversation(conv) {
  if (conv?.type === 'group' && isOwner(conv)) { toast('Сначала передайте владение другому участнику', 'warn'); return; }
  if (typeof NET !== 'undefined' && NET.online) NET.leave(conv);
  state.conversations = state.conversations.filter((c) => c.id !== conv.id);
  if (state.activeId === conv.id) {
    state.activeId = state.conversations[0]?.id || null;
    $('#app').classList.remove('chat-open');
  }
  closeAllModals();
  renderAll();
  persist();
  toast(conv.type === 'group' ? 'Вы покинули группу' : 'Переписка удалена', 'ok');
}

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const max = 1400;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return { src: canvas.toDataURL('image/jpeg', 0.85), w, h };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }
}

function prepareVideo(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    let done = false;
    const finish = (dur, w, h) => {
      if (done) return;
      done = true;
      resolve({ src: url, dur: Math.round(dur) || 12, w: w || 16, h: h || 9 });
    };
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = () => finish(video.duration, video.videoWidth, video.videoHeight);
      video.onerror = () => finish(12, 16, 9);
      video.src = url;
      setTimeout(() => finish(12, 16, 9), 3500);
    } catch (error) {
      finish(12, 16, 9);
    }
  });
}

async function handleFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const online = typeof NET !== 'undefined' && NET.online;
  for (const file of list) {
    if (file.type.startsWith('image/')) {
      if (file.size > 22 * 1024 * 1024) { toast('Изображение слишком большое (до 22 МБ)', 'warn'); continue; }
      try {
        const prepared = await prepareImage(file);
        let src = prepared.src;
        if (online) {
          try {
            src = await NET.uploadDataUrl(prepared.src, file.name || 'photo.jpg');
          } catch (error) {
            toast('Не удалось загрузить фото на сервер', 'warn');
            continue;
          }
        }
        ui.pending.push({ aid: uid('a'), k: 'img', src, title: file.name, w: prepared.w, h: prepared.h });
      } catch (error) {
        toast('Не удалось открыть изображение', 'warn');
      }
    } else if (file.type.startsWith('video/')) {
      if (file.size > 120 * 1024 * 1024) { toast('Видео слишком большое (до 120 МБ)', 'warn'); continue; }
      try {
        const prepared = await prepareVideo(file);
        let src = prepared.src;
        const att = { aid: uid('a'), k: 'vid', src, title: file.name, dur: prepared.dur, w: prepared.w, h: prepared.h, session: true };
        if (online) {
          try {
            src = await NET.uploadBlob(file, file.name || 'video.mp4');
            att.src = src;
            delete att.session;
          } catch (error) {
            toast('Не удалось загрузить видео на сервер', 'warn');
            continue;
          }
        }
        ui.pending.push(att);
      } catch (error) {
        toast('Не удалось открыть видео', 'warn');
      }
    } else {
      toast('Можно прикрепить фото или видео', 'warn');
    }
  }
  renderPending();
  $('#composerInput').focus();
}

function fillEmojiPicker() {
  const pop = $('#emojiPop');
  if (pop.dataset.ready) return;
  pop.innerHTML = `<div class="emoji-pop-label">Эмодзи</div><div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-emoji="${esc(e)}" aria-label="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
  pop.dataset.ready = '1';
}

function openEmojiPicker() {
  const pop = $('#emojiPop');
  if (!pop.hidden) { closeEmojiPicker(); return; }
  fillEmojiPicker();
  pop.hidden = false;
  const r = $('#btnEmoji').getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = Math.round(clamp(r.left + r.width / 2 - pr.width / 2, 8, window.innerWidth - pr.width - 8)) + 'px';
  pop.style.top = Math.round(Math.max(8, r.top - pr.height - 10)) + 'px';
  emojiReady = false;
  requestAnimationFrame(() => { emojiReady = true; });
}

function closeEmojiPicker() {
  const pop = $('#emojiPop');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  emojiReady = false;
}

function insertEmoji(emoji) {
  const input = $('#composerInput');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  input.focus();
  const pos = start + emoji.length;
  input.setSelectionRange(pos, pos);
  resizeComposer();
}

function openMediaFor(conv, aid) {
  const items = collectMedia(conv);
  if (!items.length) return;
  const index = Math.max(0, items.findIndex((item) => item.a.aid === aid));
  openLightbox(items, index);
}

function openGalleryFor(conv) {
  const items = collectMedia(conv);
  if (!items.length) {
    toast('В этой беседе пока нет фото и видео', 'warn');
    return;
  }
  openMediaGallery(items, convTitle(conv));
}

function resetDemo() {
  openConfirm({
    title: 'Сбросить демо-данные?',
    text: 'Все беседы, группы и сообщения будут удалены. Это действие нельзя отменить.',
    confirmLabel: 'Сбросить',
    danger: true,
    onConfirm: () => {
      try { localStorage.removeItem(STORE_KEY); } catch (error) {}
      memoryStore = null;
      state = demoState();
      ui.msgQuery = '';
      ui.replyTo = null;
      ui.pending = [];
      ui.filter = '';
      ui.view = 'all';
      $('#convFilter').value = '';
      $('#composerInput').value = '';
      closeAllModals();
      closePopover();
      closeEmojiPicker();
      renderAll();
      requestAnimationFrame(() => scrollBottom(false));
      toast('Данные сброшены', 'ok');
    }
  });
}

function openMeMenu(anchor) {
  const p = me();
  const items = [
    { title: 'Аккаунт' },
    { id: 'profile', label: 'Мой профиль', icon: 'users', onClick: () => openProfile(p.id) },
    { id: 'edit', label: 'Редактировать профиль', icon: 'edit', onClick: () => openProfileEditor() }
  ];
  if (typeof NET !== 'undefined' && NET.online) {
    items.push('sep');
    items.push({ id: 'people', label: 'Найти людей', icon: 'user-plus', onClick: () => NET.openPeopleSearch('') });
    items.push({ id: 'logout', label: 'Выйти из аккаунта', icon: 'logout', danger: true, onClick: () => NET.logout() });
  } else {
    items.push('sep');
    items.push({ id: 'logout', label: 'Выйти из аккаунта', icon: 'logout', danger: true, onClick: logoutLocal });
  }
  openMenu(anchor, items);
}

function logoutLocal() {
  openConfirm({
    title: 'Выйти из аккаунта?',
    text: 'Локальные данные в этом браузере будут очищены, откроется экран входа.',
    confirmLabel: 'Выйти',
    danger: true,
    onConfirm: () => {
      try { localStorage.removeItem(STORE_KEY); } catch (error) { /* ignore */ }
      memoryStore = null;
      location.reload();
    }
  });
}

function toggleMembers() {
  state.prefs.membersOpen = !state.prefs.membersOpen;
  $('#membersPanel').classList.toggle('is-hidden', !state.prefs.membersOpen);
  $('#btnMembers').setAttribute('aria-pressed', String(state.prefs.membersOpen));
  persist();
}

function togglePinFromPins(msgId) {
  const conv = activeConv();
  if (!conv) return;
  const msg = conv.messages.find((m) => m.id === msgId);
  if (msg) msg.pinned = false;
  conv.pinnedMsgs = (conv.pinnedMsgs || []).filter((id) => id !== msgId);
  renderMessages(conv);
  persist();
  if (msg && typeof NET !== 'undefined' && NET.online) NET.pinMessage(conv, msg);
}

function scrollToMessage(msgId) {
  const node = $(`[data-msg="${msgId}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  node.classList.add('is-flash');
  setTimeout(() => node.classList.remove('is-flash'), 1400);
}

function openDM(personId) {
  if (personId === state.me) {
    openProfile(state.me);
    return;
  }
  if (typeof NET !== 'undefined' && NET.online) {
    NET.openDM(personId).then((id) => {
      if (!id) return;
      closeAllModals();
      openConversation(id);
    }).catch(() => toast('Не удалось открыть переписку', 'warn'));
    return;
  }
  let conv = dmWith(personId);
  if (!conv) {
    conv = { id: 'dm-' + personId, type: 'dm', peer: personId, messages: [], pinnedMsgs: [], pinned: false, unread: 0 };
    state.conversations.push(conv);
  }
  closeAllModals();
  openConversation(conv.id);
}
