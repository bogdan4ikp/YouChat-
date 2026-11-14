'use strict';

function openConfirm(opts) {
  const { title, text, confirmLabel = 'Подтвердить', danger = false, onConfirm } = opts;
  const html = `<div class="modal-pad">
    <h2 class="modal-title">${esc(title)}</h2>
    <p class="modal-sub">${esc(text)}</p>
    <div class="form-actions">
      <button type="button" class="btn" data-modal-close>Отмена</button>
      <button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="confirmAction">${esc(confirmLabel)}</button>
    </div>
  </div>`;
  openModal(html, {
    size: 'sm',
    label: title,
    onMount: (modal) => {
      $('#confirmAction', modal).addEventListener('click', () => {
        closeModal();
        if (typeof onConfirm === 'function') onConfirm();
      });
    }
  });
}

function openProfileCard(personId, anchor) {
  const p = person(personId);
  const media = mediaForPerson(personId).length;
  const groups = groupsOf(personId).length;
  const self = p.id === state.me;
  const html = `
    <div class="pop-banner">${bannerHTML(p.banner, '', p.bannerImg)}</div>
    <div class="pop-body">
      <span class="pop-av">${avatarHTML(p, 56, { status: true, border: '#17171a' })}</span>
      <h3 class="pop-name">${esc(p.name)}${self ? '<span class="status-pill">это вы</span>' : ''}</h3>
      <div class="pop-handle">@${esc(p.username)}</div>
      <div class="pop-status"><span class="dot" data-st="${p.status}"></span>${statusText(p)}${p.custom ? ' · ' + esc(p.custom) : ''}</div>
      <p class="pop-bio">${esc(p.bio || 'Пользователь пока ничего не рассказал о себе.')}</p>
      <div class="pop-actions">
        <button type="button" class="btn sm" data-pop-profile="${p.id}">${icon('users')}<span>Профиль</span></button>
        ${self ? '' : `<button type="button" class="btn sm primary" data-pop-write="${p.id}">${icon('dm')}<span>Написать</span></button>`}
      </div>
      <div class="pop-stats">
        <span><b>${media}</b> медиа</span>
        <span><b>${groups}</b> групп</span>
        <span>с ${esc(fmtJoined(p.joined || Date.now()))}</span>
      </div>
      <div class="link-row">${icon('link')}<code>${esc(profileLink(p))}</code><button type="button" class="btn sm" data-copy-link>Копировать</button></div>
    </div>`;
  openPopover(anchor, html, {
    onMount: (pop) => {
      const profileBtn = $('[data-pop-profile]', pop);
      if (profileBtn) profileBtn.addEventListener('click', () => {
        closePopover();
        openProfile(p.id);
      });
    const writeBtn = $('[data-pop-write]', pop);
    if (writeBtn) writeBtn.addEventListener('click', () => {
      closePopover();
      openDM(p.id);
    });
    const copyBtn = $('[data-copy-link]', pop);
    if (copyBtn) copyBtn.addEventListener('click', () => copyText(profileLink(p)));
    }
  });
}

function openProfile(personId, tab = 'about') {
  const p = person(personId);
  if (!p || !p.id) return;
  let active = tab;
  const media = mediaForPerson(p.id);
  const groups = groupsOf(p.id);
  const self = p.id === state.me;
  const closedGroups = groups.filter((g) => !g.members.includes(state.me)).length;

  const aboutHTML = () => `
    ${p.custom ? `<div class="about-block"><h4>Статус</h4><p>${esc(p.custom)}</p></div>` : ''}
    <div class="mc-stats">
      <div><b>${media.length}</b><span>медиа</span></div>
      <div><b>${groups.length}</b><span>групп</span></div>
      <div><b>${groups.length - closedGroups}</b><span>общих чатов</span></div>
      <div><b>${esc(fmtJoined(p.joined || Date.now()))}</b><span>в YouChat</span></div>
    </div>
    <div class="about-block"><h4>Обо мне</h4><p>${esc(p.bio || 'Пользователь пока ничего не рассказал о себе.')}</p></div>
    <div class="about-block"><h4>Адрес</h4><p>@${esc(p.username)} · <span class="status-pill"><span class="dot" data-st="${p.status}"></span>${statusText(p)}</span></p></div>`;

  const mediaHTML = () => media.length
    ? `<div class="gallery">${media.map((item, index) => `
        <button type="button" class="gal-item" data-media-index="${index}" aria-label="Открыть ${esc(item.a.title || 'медиа')}">
          <img src="${posterSrc(item.a)}" alt="${esc(item.a.title || 'Медиа')}">
          ${item.a.k === 'vid' ? `<span class="vtag">${icon('play')}</span>` : ''}
        </button>`).join('')}</div>
        <p class="hint" style="margin-top:10px">${media.length} файлов · клик открывает просмотрщик с навигацией</p>`
    : `<div class="tab-empty">Пока нет фото и видео. Стоит начать с чего-нибудь красивого.</div>`;

  const groupsHTML = () => groups.length
    ? `<div class="mem-list">${groups.map((g) => {
        const role = g.roles?.[p.id];
        return `<button type="button" class="mem-row" data-group-open="${g.id}">
          ${groupAvatarHTML(g, 36)}
          <span class="member-meta">
            <span class="member-name">${esc(g.name)}</span>
            <span class="member-sub">${membersLabel(g.members.length)} · ${esc(g.handle ? '@' + g.handle : '')}</span>
          </span>
          <span class="mem-role ${role === 'owner' ? 'owner' : ''}">${esc(roleLabel(role || 'member'))}</span>
        </button>`;
      }).join('')}</div>`
    : `<div class="tab-empty">Пользователь пока не состоит в группах.</div>`;

  const tabContent = () => active === 'media' ? mediaHTML() : active === 'groups' ? groupsHTML() : aboutHTML();

  const build = () => `
    <div class="mc-banner">${bannerHTML(p.banner, '', p.bannerImg)}</div>
    <div class="mc-top">
      <span class="mc-av">${avatarHTML(p, 88, { status: true, border: 'var(--bg-3)' })}</span>
      <div class="mc-id">
        <h2 class="mc-name">${esc(p.name)}${self ? '<span class="status-pill">это вы</span>' : ''}</h2>
        <div class="mc-handle">@${esc(p.username)} <span class="status-pill"><span class="dot" data-st="${p.status}"></span>${statusText(p)}</span></div>
      </div>
      <div class="mc-actions">
        ${self
          ? `<button type="button" class="btn primary" data-edit-profile>${icon('edit')}<span>Редактировать профиль</span></button>`
          : `<button type="button" class="btn primary" data-write-person="${p.id}">${icon('dm')}<span>Написать сообщение</span></button>`}
      </div>
    </div>
    <div class="mc-body">
      <div class="link-row">${icon('link')}<code>${esc(profileLink(p))}</code><button type="button" class="btn sm" data-copy-profile>Копировать</button></div>
      <div class="tabs" role="tablist" style="margin-top:14px">
        <button type="button" class="tab ${active === 'about' ? 'is-active' : ''}" data-ptab="about" role="tab" aria-selected="${active === 'about'}">Обо мне</button>
        <button type="button" class="tab ${active === 'media' ? 'is-active' : ''}" data-ptab="media" role="tab" aria-selected="${active === 'media'}">Медиа · ${media.length}</button>
        <button type="button" class="tab ${active === 'groups' ? 'is-active' : ''}" data-ptab="groups" role="tab" aria-selected="${active === 'groups'}">Группы · ${groups.length}</button>
      </div>
      ${tabContent()}
    </div>`;

  const mount = (modal) => {
    $$('[data-ptab]', modal).forEach((btn) => {
      btn.addEventListener('click', () => {
        active = btn.dataset.ptab;
        refreshModal(build(), mount, 'lg');
      });
    });
    const edit = $('[data-edit-profile]', modal);
    if (edit) edit.addEventListener('click', () => { closeAllModals(); openProfileEditor(); });
    const write = $('[data-write-person]', modal);
    if (write) write.addEventListener('click', () => openDM(write.dataset.writePerson));
    const copyProfile = $('[data-copy-profile]', modal);
    if (copyProfile) copyProfile.addEventListener('click', () => copyText(profileLink(p)));
    $$('[data-media-index]', modal).forEach((btn) => {
      btn.addEventListener('click', () => openLightbox(media, Number(btn.dataset.mediaIndex), { title: p.name }));
    });
    $$('[data-group-open]', modal).forEach((btn) => {
      btn.addEventListener('click', () => openGroupCard(btn.dataset.groupOpen));
    });
  };

  openModal(build(), { size: 'lg', label: `Профиль ${p.name}`, onMount: mount });
}

function membersTabHTML(conv) {
  const order = ['owner', 'admin', 'member'];
  const labels = { owner: 'Основатель', admin: 'Админы', member: 'Участники' };
  const rank = { online: 0, idle: 1, dnd: 2, offline: 3 };
  let html = '<div class="mem-list" style="gap:7px">';
  order.forEach((role) => {
    const ids = conv.members.filter((id) => (conv.roles?.[id] || 'member') === role);
    if (!ids.length) return;
    html += `<div class="mem-label" style="padding-left:2px">${labels[role]} <span>${ids.length}</span></div>`;
    ids.map((id) => person(id))
      .sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || a.name.localeCompare(b.name, 'ru'))
      .forEach((p) => {
        const canMenu = canManageMember(conv, p.id);
        html += `<div class="member-wrap">
          <button type="button" class="mem-row" data-profile-open="${p.id}">
            ${avatarHTML(p, 38, { status: true, border: 'var(--bg-3)' })}
            <span class="member-meta">
              <span class="member-name">${esc(p.name)}</span>
              <span class="member-sub">${esc(p.custom || statusText(p))}</span>
            </span>
            <span class="mem-role ${role === 'owner' ? 'owner' : ''}">${esc(roleLabel(role))}</span>
          </button>
          ${canMenu ? `<button type="button" class="member-menu-btn" data-member-menu="${conv.id}|${p.id}" aria-label="Действия с участником">${icon('more')}</button>` : ''}
        </div>`;
      });
  });
  return html + '</div>';
}

function openGroupCard(convId, tab = 'members') {
  const conv = findConv(convId);
  if (!conv || conv.type !== 'group') return;
  let active = tab;
  const media = collectMedia(conv);
  const canManage = ['owner', 'admin'].includes(conv.roles?.[state.me]);
  const canEditGroup = isOwner(conv);
  const owner = person(conv.members.find((id) => conv.roles?.[id] === 'owner') || conv.members[0]);
  const isMember = conv.members.includes(state.me);
  const requests = conv.joinRequests || [];
  const showRequests = isGroupAdmin(conv) && conv.requestsOn !== false;
  const showAdmin = isGroupAdmin(conv);

  const aboutHTML = () => `
    <p class="mc-desc">${esc(conv.desc || 'Описание пока не добавлено.')}</p>
    <div class="link-row">${icon('link')}<code>${esc(groupLink(conv))}</code><button type="button" class="btn sm" data-copy-group>Копировать</button></div>
    <div class="about-rows" style="margin-top:16px">
      <div><span>Создана</span><b>${esc(fmtDayLong(conv.created || Date.now()))}</b></div>
      <div><span>Владелец</span><b>${esc(owner.name)}</b></div>
      <div><span>Доступ</span><b>${conv.access === 'open' ? icon('unlock') : icon('lock')} ${esc(accessLabel(conv))}</b></div>
      <div><span>Заявки</span><b>${conv.requestsOn === false ? 'Выключены' : 'Включены'}</b></div>
      <div><span>Медиа</span><b>${media.length} файлов</b></div>
    </div>
    <div class="about-block"><h4>Роли</h4><p>Владелец — создатель группы: только он меняет настройки, назначает админов и может передать владение. Админы следят за порядком в рамках выданных прав. Участники общаются и делятся медиа.</p></div>`;

  const requestsHTML = () => {
    if (!showRequests) return `<div class="tab-empty">Заявки видят владелец и админы.</div>`;
    const canDecide = adminPerm(conv, 'acceptRequests');
    if (!canDecide) return `<div class="tab-empty">Владелец не дал админам право принимать заявки.</div>`;
    if (!requests.length) {
      return `<div class="req-empty">
        <span>Пока никто не просится в группу.</span>
      </div>`;
    }
    return `<div class="req-list">${requests.map((r) => {
      const p = person(r.personId);
      return `<div class="req-row">
        ${avatarHTML(p, 36, { status: true, border: 'var(--bg-3)' })}
        <span class="member-meta">
          <span class="member-name">${esc(p.name)}</span>
          <span class="member-sub">@${esc(p.username)} · ${fmtShort(r.at)}</span>
        </span>
        <button type="button" class="btn sm primary" data-req-accept="${r.id}">Принять</button>
        <button type="button" class="btn sm" data-req-reject="${r.id}">Отклонить</button>
      </div>`;
    }).join('')}</div>`;
  };

  const mediaHTML = () => media.length
    ? `<div class="gallery">${media.map((item, index) => `
        <button type="button" class="gal-item" data-card-media="${index}" aria-label="Открыть ${esc(item.a.title || 'медиа')}">
          <img src="${posterSrc(item.a)}" alt="${esc(item.a.title || 'Медиа')}">
          ${item.a.k === 'vid' ? `<span class="vtag">${icon('play')}</span>` : ''}
        </button>`).join('')}</div>
        <p class="hint" style="margin-top:10px">Все фото и видео из переписки группы</p>`
    : `<div class="tab-empty">В группе пока нет фото и видео.</div>`;

  const adminHTML = () => {
    const perms = conv.perms?.admins || {};
    const admins = conv.members.filter((id) => conv.roles?.[id] === 'admin').length;
    const msgs = conv.messages.filter((m) => !m.sys && !m.deleted).length;
    const stat = (n, label) => `<div class="adm-stat"><b>${n}</b><span>${label}</span></div>`;
    const permRow = (key, title, hint) => `<label class="perm-row">
      <span class="switch-meta"><b>${title}</b><span>${hint}</span></span>
      <input type="checkbox" data-perm="${key}" ${perms[key] !== false ? 'checked' : ''} ${isOwner(conv) ? '' : 'disabled'}>
    </label>`;
    const log = (conv.audit || []).slice(0, 20).map((e) => `<div class="adm-log"><span>${esc(fmtShort(e.t))}</span><b>${esc(person(e.by).name.split(' ')[0])}</b><span class="adm-log-text">${esc(e.text)}</span></div>`).join('');
    return `<div class="adm-stats">${stat(conv.members.length, 'участников')}${stat(admins, 'админов')}${stat(msgs, 'сообщений')}${stat(requests.length, 'заявок')}</div>
      ${requests.length && adminPerm(conv, 'acceptRequests') ? `<button type="button" class="btn sm primary adm-bulk" data-accept-all>${icon('user-plus')}<span>Принять все заявки · ${requests.length}</span></button>` : ''}
      <div class="about-block"><h4>Права админов</h4>${isOwner(conv) ? '' : '<p class="hint" style="margin:0 0 6px">Менять права может только владелец.</p>'}
        <div class="perms">
          ${permRow('deleteMessages', 'Удалять чужие сообщения', 'Иначе админ удаляет только свои.')}
          ${permRow('removeMembers', 'Исключать участников', 'Только обычных участников — админов исключает владелец.')}
          ${permRow('acceptRequests', 'Принимать заявки', 'Одобрять вступление по ссылке.')}
        </div>
      </div>
      <div class="about-block"><h4>Журнал действий</h4>${log || '<p class="hint" style="margin:0">Пока пусто — здесь появятся действия владельца и админов.</p>'}</div>`;
  };

  const content = () => active === 'admin' ? adminHTML() : active === 'media' ? mediaHTML() : active === 'about' ? aboutHTML() : active === 'requests' ? requestsHTML() : membersTabHTML(conv);

  const build = () => `
    <div class="mc-banner">${bannerHTML(conv.banner, '', conv.bannerImg)}</div>
    <div class="mc-top">
      <span class="mc-av">${groupAvatarHTML(conv, 88)}</span>
      <div class="mc-id">
        <h2 class="mc-name">${esc(conv.name)}${conv.access === 'open' ? icon('unlock') : icon('lock')}</h2>
        <div class="mc-handle">@${esc(conv.handle || 'group')} <span class="status-pill">${membersLabel(conv.members.length)}</span> <span class="status-pill">${groupOnlineCount(conv)} в сети</span> <span class="status-pill">${esc(accessLabel(conv))}</span></div>
      </div>
      <div class="mc-actions">
        ${canManage ? `<button type="button" class="btn primary" data-invite-people>${icon('user-plus')}<span>Пригласить</span></button>` : ''}
        ${canEditGroup ? `<button type="button" class="btn" data-edit-group>${icon('edit')}<span>Изменить</span></button>` : ''}
        ${isMember && !isOwner(conv) ? `<button type="button" class="btn danger" data-leave-group>${icon('logout')}<span>Покинуть</span></button>` : isOwner(conv) ? `<p class="hint">Владелец не может покинуть группу, пока не передаст владение.</p>` : ''}
      </div>
    </div>
    <div class="mc-body">
      ${conv.desc ? `<p class="mc-desc">${esc(conv.desc)}</p>` : ''}
      <div class="link-row">${icon('link')}<code>${esc(groupLink(conv))}</code><button type="button" class="btn sm" data-copy-group>Копировать</button></div>
      <div class="tabs" role="tablist" style="margin-top:14px">
        <button type="button" class="tab ${active === 'members' ? 'is-active' : ''}" data-gtab="members" role="tab" aria-selected="${active === 'members'}">Участники · ${conv.members.length}</button>
        <button type="button" class="tab ${active === 'media' ? 'is-active' : ''}" data-gtab="media" role="tab" aria-selected="${active === 'media'}">Медиа · ${media.length}</button>
        ${showRequests ? `<button type="button" class="tab ${active === 'requests' ? 'is-active' : ''}" data-gtab="requests" role="tab" aria-selected="${active === 'requests'}">Заявки · ${requests.length}</button>` : ''}
        ${showAdmin ? `<button type="button" class="tab ${active === 'admin' ? 'is-active' : ''}" data-gtab="admin" role="tab" aria-selected="${active === 'admin'}">${icon('shield')}Управление</button>` : ''}
        <button type="button" class="tab ${active === 'about' ? 'is-active' : ''}" data-gtab="about" role="tab" aria-selected="${active === 'about'}">О группе</button>
      </div>
      ${content()}
    </div>`;

  const mount = (modal) => {
    $$('[data-gtab]', modal).forEach((btn) => {
      btn.addEventListener('click', () => {
        active = btn.dataset.gtab;
        refreshModal(build(), mount, 'xl');
      });
    });
    $$('[data-profile-open]', modal).forEach((btn) => {
      btn.addEventListener('click', () => { closeAllModals(); openProfile(btn.dataset.profileOpen); });
    });
    $$('[data-card-media]', modal).forEach((btn) => {
      btn.addEventListener('click', () => openLightbox(media, Number(btn.dataset.cardMedia)));
    });
    const edit = $('[data-edit-group]', modal);
    if (edit) edit.addEventListener('click', () => { closeAllModals(); openGroupEditor(conv.id); });
    const invite = $('[data-invite-people]', modal);
    if (invite) invite.addEventListener('click', () => { closeAllModals(); openInvite(conv.id); });
    const leave = $('[data-leave-group]', modal);
    if (leave) leave.addEventListener('click', () => {
      openConfirm({
        title: `Покинуть «${conv.name}»?`,
        text: 'Группа исчезнет из вашего списка вместе с историей сообщений и вложениями.',
        confirmLabel: 'Покинуть группу',
        danger: true,
        onConfirm: () => removeConversation(conv)
      });
    });
    const copyGroup = $('[data-copy-group]', modal);
    if (copyGroup) copyGroup.addEventListener('click', () => copyText(groupLink(conv)));
    $$('[data-req-accept]', modal).forEach((btn) => btn.addEventListener('click', () => decideRequest(conv.id, btn.dataset.reqAccept, true)));
    $$('[data-req-reject]', modal).forEach((btn) => btn.addEventListener('click', () => decideRequest(conv.id, btn.dataset.reqReject, false)));
    $$('[data-perm]', modal).forEach((input) => input.addEventListener('change', () => {
      setAdminPerm(conv.id, input.dataset.perm, input.checked);
      toast('Права обновлены', 'ok');
    }));
    const acceptAll = $('[data-accept-all]', modal);
    if (acceptAll) acceptAll.addEventListener('click', () => acceptAllRequests(conv.id));
  };

  openModal(build(), { size: 'xl', label: `Группа ${conv.name}`, onMount: mount });
}

function openPins(conv) {
  const target = conv || activeConv();
  if (!target) return;
  const ids = target.pinnedMsgs || [];
  const msgs = ids.map((id) => target.messages.find((m) => m.id === id)).filter(Boolean);
  const rows = msgs.length ? msgs.map((m) => {
    const a = person(m.author);
    const snippet = m.text || (m.att?.length ? (m.att[0].k === 'vid' ? 'Видео' : `Фото · ${m.att.length}`) : 'Сообщение');
    return `<div class="pin-row">
      <button type="button" class="pin-main" data-pin-jump="${m.id}">
        ${avatarHTML(a, 36, { status: true, border: '#161618' })}
        <span class="pin-meta">
          <span class="pin-top"><b>${esc(a.name)}</b><span>${fmtShort(m.t)}</span></span>
          <span class="pin-text">${esc(snippet.slice(0, 150))}</span>
        </span>
      </button>
      <button type="button" class="icon-btn sm" data-pin-remove="${m.id}" aria-label="Открепить сообщение">${icon('close')}</button>
    </div>`;
  }).join('') : `<div class="tab-empty">В этой беседе пока нет закреплённых сообщений.</div>`;

  const html = `<div class="modal-pad">
    <h2 class="modal-title">Закреплённые сообщения</h2>
    <p class="modal-sub">${msgs.length ? `${msgs.length} в «${esc(convTitle(target))}»` : 'Здесь появятся важные сообщения'}</p>
    <div class="pin-list">${rows}</div>
  </div>`;

  openModal(html, {
    size: 'md',
    label: 'Закреплённые сообщения',
    onMount: (modal) => {
      $$('[data-pin-jump]', modal).forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.pinJump;
          closeAllModals();
          if (typeof closeSearchPanel === 'function') closeSearchPanel();
          setTimeout(() => scrollToMessage(id), 160);
        });
      });
      $$('[data-pin-remove]', modal).forEach((btn) => {
        btn.addEventListener('click', () => {
          togglePin(btn.dataset.pinRemove);
          closeAllModals();
          openPins(target);
        });
      });
    }
  });
}

function openMediaGallery(items, title) {
  if (!items.length) return;
  const html = `<div class="modal-pad">
    <h2 class="modal-title">${esc(title || 'Медиа')}</h2>
    <p class="modal-sub">${items.length} фото и видео · клик открывает просмотрщик</p>
    <div class="gallery">
      ${items.map((item, index) => `
        <button type="button" class="gal-item" data-gal-index="${index}" aria-label="Открыть ${esc(item.a.title || 'медиа')}">
          <img src="${posterSrc(item.a)}" alt="${esc(item.a.title || 'Медиа')}">
          ${item.a.k === 'vid' ? `<span class="vtag">${icon('play')}</span>` : ''}
        </button>`).join('')}
    </div>
  </div>`;
  openModal(html, {
    size: 'lg',
    label: 'Медиа',
    onMount: (modal) => {
      $$('[data-gal-index]', modal).forEach((btn) => {
        btn.addEventListener('click', () => openLightbox(items, Number(btn.dataset.galIndex), { title }));
      });
    }
  });
}

function openInvite(convId) {
  const conv = findConv(convId);
  if (!conv) return;
  const candidates = contacts().filter((p) => !conv.members.includes(p.id));
  if (!candidates.length) {
    openModal(`<div class="modal-pad">
      <h2 class="modal-title">Пригласить в группу</h2>
      <p class="modal-sub">Добавить можно только тех, с кем вы уже переписывались. Сейчас таких нет или все уже в группе.</p>
      <div class="form-actions"><button type="button" class="btn primary" data-modal-close>Понятно</button></div>
    </div>`, { size: 'sm', label: 'Пригласить' });
    return;
  }
  const html = `<div class="modal-pad">
    <h2 class="modal-title">Пригласить в «${esc(conv.name)}»</h2>
    <p class="modal-sub">Ссылка открывает вступление в группу (${esc(accessLabel(conv).toLowerCase())}). Или добавьте людей сразу.</p>
    <div class="link-row">${icon('link')}<code>${esc(groupLink(conv))}</code><button type="button" class="btn sm" data-copy-invite>Копировать</button></div>
    <form id="inviteForm" novalidate style="margin-top:12px">
      <div class="pick-list" style="max-height:320px;overflow:auto;margin:6px -6px 4px">
        ${candidates.map((p) => `<label class="pick">
          ${avatarHTML(p, 34, { status: true, border: '#161618' })}
          <span class="pick-meta"><span class="pick-name">${esc(p.name)}</span><span class="pick-sub">@${esc(p.username)} · ${esc(p.custom || statusText(p))}</span></span>
          <input type="checkbox" value="${p.id}">
        </label>`).join('')}
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-modal-close>Отмена</button>
        <button type="submit" class="btn primary">${icon('user-plus')}<span>Добавить</span></button>
      </div>
    </form>
  </div>`;
  openModal(html, {
    size: 'md',
    label: 'Пригласить в группу',
    onMount: (modal) => {
      const copyInvite = $('[data-copy-invite]', modal);
      if (copyInvite) copyInvite.addEventListener('click', () => copyText(groupLink(conv)));
      $$('.pick input', modal).forEach((input) => {
        input.addEventListener('change', () => input.closest('.pick').classList.toggle('is-on', input.checked));
      });
      $('#inviteForm', modal).addEventListener('submit', async (event) => {
        event.preventDefault();
        const ids = $$('.pick input:checked', modal).map((i) => i.value);
        if (!ids.length) { toast('Выберите хотя бы одного человека', 'warn'); return; }
        if (typeof NET !== 'undefined' && NET.online) {
          try {
            await NET.addMembers(conv, ids);
          } catch (error) {
            toast(error.message || 'Не удалось добавить участников', 'warn');
            return;
          }
          closeAllModals();
          renderAll();
          openGroupCard(conv.id, 'members');
          toast(ids.length === 1 ? 'Участник добавлен' : `Добавлено: ${ids.length}`, 'ok');
          return;
        }
        ids.forEach((id) => {
          if (!conv.members.includes(id)) {
            conv.members.push(id);
            conv.roles[id] = 'member';
          }
        });
        conv.messages.push({
          id: uid('m'), author: state.me, t: Date.now(), sys: `${me().name} добавила в группу: ${ids.map((id) => person(id).name).join(', ')}`,
          text: '', att: [], react: {}, reply: null, pinned: false
        });
        closeAllModals();
        renderAll();
        openGroupCard(conv.id, 'members');
        persist();
        toast(ids.length === 1 ? 'Участник добавлен' : `Добавлено: ${ids.length}`, 'ok');
      });
    }
  });
}
