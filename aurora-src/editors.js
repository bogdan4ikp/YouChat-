'use strict';

function bannerPickerHTML(draft) {
  return `<div data-banner-picker>
    <div class="bn-gallery">
      <div class="bn-shot" data-bn-shot>${draft.bannerImg ? `<img src="${draft.bannerImg}" alt="">` : '<span>Загрузите своё фото — оно станет баннером</span>'}</div>
      <div class="bn-gallery-actions">
        <button type="button" class="btn sm primary" data-bn-upload>${icon('image')}<span>Загрузить из галереи</span></button>
        <button type="button" class="btn sm" data-bn-clear ${draft.bannerImg ? '' : 'disabled'}>Убрать фото</button>
      </div>
    </div>
    <input type="file" accept="image/*,video/*" data-bn-file hidden aria-label="Баннер из галереи">
  </div>`;
}

function syncBannerPicker(container, draft) {
  if (!container) return;
  $$('[data-banner-pick]', container).forEach((btn) => {
    const on = !draft.bannerImg && btn.dataset.bannerPick === draft.banner;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
    const tick = $('.bn-tick', btn);
    if (on && !tick) btn.insertAdjacentHTML('beforeend', `<span class="bn-tick">${icon('check')}</span>`);
    if (!on && tick) tick.remove();
  });
  const shot = $('[data-bn-shot]', container);
  if (shot) shot.innerHTML = draft.bannerImg ? `<img src="${draft.bannerImg}" alt="">` : '<span>Загрузите своё фото — оно станет баннером</span>';
  const clear = $('[data-bn-clear]', container);
  if (clear) clear.disabled = !draft.bannerImg;
}

function bindBannerPicks(container, draft, onChange) {
  $$('[data-bn-tab]', container).forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.bnTab;
      $$('[data-bn-tab]', container).forEach((btn) => {
        const on = btn === tab;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-selected', String(on));
      });
      $$('[data-bn-panel]', container).forEach((panel) => { panel.hidden = panel.dataset.bnPanel !== name; });
    });
  });
  $$('[data-banner-pick]', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.banner = btn.dataset.bannerPick;
      draft.bannerImg = '';
      syncBannerPicker(container, draft);
      onChange();
    });
  });
  const file = $('[data-bn-file]', container);
  const upload = $('[data-bn-upload]', container);
  if (upload && file) upload.addEventListener('click', () => file.click());
  const preview = container.closest('.modal')?.querySelector('.ep-banner');
  if (preview && file) { preview.classList.add('is-editable'); preview.addEventListener('click', () => file.click()); }
  if (file) {
    file.addEventListener('change', async (event) => {
      const chosen = event.target.files?.[0];
      event.target.value = '';
      if (!chosen) return;
      if (!/^(image|video)\//.test(chosen.type)) { toast('Нужно фото или видео', 'warn'); return; }
      const cropped = await cropMedia(chosen, 'banner');
      if (!cropped) return;
      draft.bannerImg = cropped;
      syncBannerPicker(container, draft);
      onChange();
      toast('Баннер готов', 'ok');
    });
  }
  const clear = $('[data-bn-clear]', container);
  if (clear) {
    clear.addEventListener('click', () => {
      draft.bannerImg = '';
      syncBannerPicker(container, draft);
      onChange();
      toast('Баннер убран', 'ok');
    });
  }
}

function bindHandleInput(input, draft, paint, selfId = null) {
  input.addEventListener('input', () => {
    const clean = cleanHandle(input.value);
    input.value = clean;
    draft.handle = clean;
    if (clean.length >= 3 && handleTaken('group', clean, selfId)) {
      markFieldError(input, true, 'Такой адрес уже занят');
    } else {
      markFieldError(input, false);
    }
    paint();
  });
}

function markFieldError(input, hasError, message) {
  if (!input) return;
  const field = input.closest('.field');
  if (field) {
    field.classList.toggle('has-err', hasError);
    if (message) {
      const err = $('.err-text', field);
      if (err) err.textContent = message;
    }
  }
  input.classList.toggle('err', hasError);
}

function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        canvas.getContext('2d').drawImage(
          image,
          (image.naturalWidth - side) / 2,
          (image.naturalHeight - side) / 2,
          side, side, 0, 0, 256, 256
        );
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    image.src = url;
  });
}

function fileToBanner(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const ratio = 1200 / 480;
        const sourceRatio = image.naturalWidth / image.naturalHeight;
        let sw = image.naturalWidth;
        let sh = image.naturalHeight;
        if (sourceRatio > ratio) sw = image.naturalHeight * ratio;
        else sh = image.naturalWidth / ratio;
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 480;
        canvas.getContext('2d').drawImage(
          image,
          (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh,
          0, 0, 1200, 480
        );
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    image.src = url;
  });
}

function setHandleState(node, kind, value, selfId = null) {
  if (!node) return;
  if (!value) { node.textContent = ''; node.className = 'field-note'; return; }
  if (value.length < 3) { node.textContent = 'Минимум 3 символа'; node.className = 'field-note warn'; return; }
  if (handleTaken(kind, value, selfId)) {
    node.textContent = 'Занят — выберите другой';
    node.className = 'field-note bad';
    return;
  }
  node.textContent = 'Свободен';
  node.className = 'field-note ok';
}

function swatchesHTML(selected) {
  return GRADS.map((grad, index) => `
    <button type="button" class="swatch ${index === selected ? 'is-active' : ''}" data-grad="${index}"
      style="--g1:${grad[0]};--g2:${grad[1]}" aria-label="Цвет аватара ${index + 1}" aria-pressed="${index === selected}"></button>`).join('');
}

function openProfileEditor() {
  const source = me();
  const draft = {
    name: source.name, username: source.username, custom: source.custom || '',
    bio: source.bio || '', grad: source.grad || 0, banner: source.banner || 'mono',
    bannerImg: source.bannerImg || '', avatar: source.avatar || null
  };
  const html = `<div class="modal-pad">
    <h2 class="modal-title">Редактировать профиль</h2>
    <p class="modal-sub">Этот профиль видят участники групп и личных переписок.</p>
    <div class="editor-preview">
      <div class="ep-banner" id="epBanner">${bannerHTML(draft.banner, '', draft.bannerImg)}</div>
      <div class="ep-row">
        <span class="av-edit">
          <span class="ep-av" id="epAvatar">${avatarHTML(draft, 76, { status: true, border: '#141416' })}</span>
          <button type="button" class="av-edit-btn" id="avatarPick" aria-label="Загрузить фото профиля">${icon('camera')}</button>
        </span>
        <div class="ep-id">
          <div class="ep-name" id="epName">${esc(draft.name)}</div>
          <div class="ep-user" id="epUser">@${esc(draft.username)}</div>
        </div>
      </div>
      <div class="ep-bio" id="epBio">${esc(draft.bio || 'Пара строк о себе — и профиль станет живым.')}</div>
    </div>
    <form id="profileForm" novalidate>
      <div class="form-grid">
        <div class="field">
          <label class="flabel" for="pfName">Отображаемое имя</label>
          <input class="input" id="pfName" maxlength="32" value="${esc(draft.name)}" autocomplete="off">
          <div class="err-text">Введите имя (минимум 2 символа)</div>
        </div>
        <div class="field">
          <label class="flabel" for="pfUser">Короткий адрес</label>
          <input class="input" id="pfUser" maxlength="24" value="${esc(draft.username)}" autocomplete="off">
          <div class="err-text">Только латиница, цифры и _ — 3–24 символа</div>
          <div class="field-note" id="pfUserState"></div>
        </div>
      </div>
      <div class="field">
        <label class="flabel" for="pfStatus">Статус</label>
        <input class="input" id="pfStatus" maxlength="48" value="${esc(draft.custom)}" >
      </div>
      <div class="field">
        <label class="flabel" for="pfBio">О себе</label>
        <textarea class="input" id="pfBio" maxlength="190" >${esc(draft.bio)}</textarea>
        <div class="hint">До 190 символов. Показывается в профиле и карточке.</div>
      </div>
      <div class="field">
        <span class="flabel">Аватар</span>
        <div class="swatches" id="pfSwatches">${swatchesHTML(draft.grad)}</div>
        <div class="hint" style="margin-top:8px">Выберите фото или видео из галереи и сами выберите, что попадёт в круг.</div>
        <div class="av-pick-row">
          <button type="button" class="btn sm" id="avatarPickBtn">${icon('image')}<span>Выбрать из галереи</span></button>
          <button type="button" class="btn ghost sm" id="avatarClear">Убрать фото</button>
        </div>
      </div>
      <div class="field">
        <span class="flabel">Баннер профиля</span>
        <div class="hint" style="margin:-1px 0 8px">Загрузите фото из галереи — оно станет баннером профиля.</div>
        <div id="bannerPicker">${bannerPickerHTML(draft)}</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-cancel-edit>Отмена</button>
        <button type="submit" class="btn primary">${icon('check')}<span>Сохранить</span></button>
      </div>
    </form>
    <input type="file" id="avatarFile" accept="image/*,video/*" hidden aria-label="Загрузить фото профиля">
  </div>`;

  const mount = (modal) => {
    const previewAvatar = () => {
      $('#epAvatar', modal).innerHTML = avatarHTML(draft, 76, { status: true, border: '#141416' });
    };
    const previewText = () => {
      $('#epName', modal).textContent = draft.name || 'Без имени';
      $('#epUser', modal).textContent = '@' + (draft.username || 'username');
      $('#epBio', modal).textContent = draft.bio || 'Пара строк о себе — и профиль станет живым.';
    };

    $('#pfName', modal).addEventListener('input', (event) => {
      draft.name = event.target.value;
      markFieldError(event.target, false);
      previewText();
      previewAvatar();
    });
    const userState = $('#pfUserState', modal);
    setHandleState(userState, 'person', draft.username, state.me);
    $('#pfUser', modal).addEventListener('input', (event) => {
      const clean = cleanHandle(event.target.value, false);
      event.target.value = clean;
      draft.username = clean;
      setHandleState(userState, 'person', clean, state.me);
      if (clean.length >= 3 && handleTaken('person', clean, state.me)) {
        markFieldError(event.target, true, 'Этот адрес уже занят');
      } else {
        markFieldError(event.target, false);
      }
      previewText();
    });
    $('#pfStatus', modal).addEventListener('input', (event) => { draft.custom = event.target.value; });
    $('#pfBio', modal).addEventListener('input', (event) => {
      draft.bio = event.target.value;
      previewText();
    });
    $$('[data-grad]', modal).forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.grad = Number(btn.dataset.grad);
        $$('[data-grad]', modal).forEach((b) => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        previewAvatar();
      });
    });

    const picker = $('#bannerPicker', modal);
    const paintBanner = () => {
      $('#epBanner', modal).innerHTML = bannerHTML(draft.banner, '', draft.bannerImg);
    };
    bindBannerPicks(picker, draft, paintBanner);

    const openAvatarPicker = () => $('#avatarFile', modal).click();
    $('#avatarPick', modal).addEventListener('click', openAvatarPicker);
    const avatarPickBtn = $('#avatarPickBtn', modal);
    if (avatarPickBtn) avatarPickBtn.addEventListener('click', openAvatarPicker);
    $('#avatarFile', modal).addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.value = '';
      if (!/^(image|video)\//.test(file.type)) { toast('Нужно фото или видео', 'warn'); return; }
      const cropped = await cropMedia(file, 'avatar');
      if (!cropped) return;
      draft.avatar = cropped;
      previewAvatar();
      toast('Фото профиля готово', 'ok');
    });
    $('#avatarClear', modal).addEventListener('click', () => {
      draft.avatar = null;
      previewAvatar();
      toast('Фото профиля убрано', 'ok');
    });
    $('[data-cancel-edit]', modal).addEventListener('click', closeModal);

    $('#profileForm', modal).addEventListener('submit', async (event) => {
      event.preventDefault();
      const nameInput = $('#pfName', modal);
      const userInput = $('#pfUser', modal);
      const name = nameInput.value.trim();
      const username = userInput.value.trim().toLowerCase();
      let bad = false;
      if (name.length < 2) {
        markFieldError(nameInput, true, 'Введите имя (минимум 2 символа)');
        bad = true;
      } else {
        markFieldError(nameInput, false);
      }
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        markFieldError(userInput, true, 'Только латиница, цифры и _ — от 3 до 24 символов');
        bad = true;
      } else if (handleTaken('person', username, state.me)) {
        markFieldError(userInput, true, 'Этот адрес уже занят');
        bad = true;
      } else {
        markFieldError(userInput, false);
      }
      if (bad) {
        toast('Проверьте имя и адрес', 'warn');
        return;
      }
      const patch = {
        name,
        username,
        custom: draft.custom.trim().slice(0, 48),
        bio: draft.bio.trim().slice(0, 190),
        grad: draft.grad,
        banner: draft.banner,
        bannerImg: draft.bannerImg || '',
        avatar: draft.avatar
      };
      if (typeof NET !== 'undefined' && NET.online) {
        try {
          await NET.saveProfile(patch);
        } catch (error) {
          toast(error.message || 'Не удалось сохранить профиль', 'warn');
          return;
        }
      }
      Object.assign(state.people[state.me], patch);
      closeAllModals();
      renderAll();
      persist();
      openProfile(state.me);
      toast('Профиль обновлён', 'ok');
    });
  };

  openModal(html, { size: 'lg', label: 'Редактировать профиль', onMount: mount });
}

function groupIconInner(draft, text) {
  return draft.avatar
    ? `<img src="${draft.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;position:relative">`
    : `<span>${esc(text)}</span>`;
}

function bindGroupPhoto(modal, draft, paintIcon) {
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*,video/*';
  const pick = () => file.click();
  const btn = $('[data-grp-photo]', modal);
  const clear = $('[data-grp-photo-clear]', modal);
  const icon0 = $('#grpIcon', modal);
  if (btn) btn.addEventListener('click', pick);
  if (icon0) { icon0.style.cursor = 'pointer'; icon0.addEventListener('click', pick); }
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    if (!/^(image|video)\//.test(chosen.type)) { toast('Нужно фото или видео', 'warn'); return; }
    const cropped = await cropMedia(chosen, 'avatar');
    if (!cropped) return;
    draft.avatar = cropped;
    if (clear) clear.disabled = false;
    paintIcon();
  });
  if (clear) clear.addEventListener('click', () => { draft.avatar = ''; clear.disabled = true; paintIcon(); });
}

function groupMemberPickerHTML(selected) {
  const list = contacts();
  if (!list.length) return '<div class="hint" style="padding:10px 4px">Пока нет людей, с которыми вы переписывались. Участников можно добавить позже.</div>';
  return list
    .map((p) => `<label class="pick ${selected.includes(p.id) ? 'is-on' : ''}">
      ${avatarHTML(p, 34, { status: true, border: '#161618' })}
      <span class="pick-meta">
        <span class="pick-name">${esc(p.name)}</span>
        <span class="pick-sub">@${esc(p.username)}</span>
      </span>
      <input type="checkbox" value="${p.id}" ${selected.includes(p.id) ? 'checked' : ''}>
    </label>`).join('');
}

function groupPreviewMeta(draft) {
  return `@${draft.handle || 'group'} · ${membersLabel(draft.members.length + 1)}`;
}

function openCreateGroup() {
  const groupCount = state.conversations.filter((c) => c.type === 'group').length + 1;
  const draft = {
    name: '',
    handle: '',
    desc: '',
    banner: 'mono',
    bannerImg: '',
    avatar: '',
    grad: 0,
    access: 'closed',
    requestsOn: true,
    members: []
  };

  const html = `<div class="modal-pad">
    <h2 class="modal-title">Создать группу</h2>
    <p class="modal-sub">Соберите людей, выберите баннер — и можно начинать.</p>
    <div class="editor-preview">
      <div class="ep-banner" id="grpBanner">${bannerHTML(draft.banner, '', draft.bannerImg)}</div>
      <div class="ep-row">
        <span class="gicon" id="grpIcon" style="--s:76px;border:4px solid #161618;--g1:${GRADS[draft.grad][0]};--g2:${GRADS[draft.grad][1]}"><span>?</span></span>
        <div class="ep-id">
          <div class="ep-name" id="grpPreviewName">Новая группа</div>
          <div class="ep-user" id="grpPreviewMeta">${esc(groupPreviewMeta(draft))}</div>
        </div>
      </div>
      <div class="ep-bio muted" id="grpPreviewDesc">Описание появится здесь.</div>
    </div>
    <form id="groupForm" novalidate>
      <div class="form-grid">
        <div class="field">
          <label class="flabel" for="grpName">Название</label>
          <input class="input" id="grpName" maxlength="40" autocomplete="off">
          <div class="err-text">Название от 2 до 40 символов</div>
        </div>
        <div class="field">
          <label class="flabel" for="grpHandle">Короткий адрес</label>
          <input class="input" id="grpHandle" maxlength="24" value="" autocomplete="off" autocapitalize="none" spellcheck="false">
          <div class="err-text">Только латиница, цифры и дефис — 3–24 символа</div>
          <div class="field-note" data-handle-state></div>
        </div>
      </div>
      <div class="field">
        <label class="flabel" for="grpDesc">Описание</label>
        <textarea class="input" id="grpDesc" maxlength="220"></textarea>
      </div>
      <div class="field">
        <span class="flabel">Доступ</span>
        <input type="hidden" id="grpAccess" value="closed">
        <div class="access-pick">
          <button type="button" class="access-opt is-on" data-access="closed">
            <b>${icon('lock')} Закрытая</b>
            <span>Вступить можно по ссылке и заявке — решают владелец и админы.</span>
          </button>
          <button type="button" class="access-opt" data-access="open">
            <b>${icon('unlock')} Открытая</b>
            <span>Вступление по ссылке без заявки.</span>
          </button>
        </div>
      </div>
      <div class="field">
        <div class="switch-row">
          <span class="switch-meta">
            <b>Заявки на вступление</b>
            <span>Кто пришёл по ссылке — подаёт заявку. Видят её только владелец и админы.</span>
          </span>
          <input type="checkbox" id="grpRequests" checked aria-label="Заявки на вступление">
        </div>
      </div>
      <div class="form-grid">
        <div class="field">
          <span class="flabel">Цвет иконки</span>
          <div class="swatches" id="grpSwatches">${swatchesHTML(draft.grad)}</div>
          <div class="bn-gallery-actions"><button type="button" class="btn sm primary" data-grp-photo>${icon('image')}<span>Фото из галереи</span></button><button type="button" class="btn sm" data-grp-photo-clear ${draft.avatar ? '' : 'disabled'}>Убрать</button></div>
        </div>
        <div class="field">
          <span class="flabel">Участники</span>
          <div class="hint" style="margin-top:-2px">Можно добавить позже — кнопкой «Пригласить» в карточке.</div>
          <div class="pick-list" id="grpMembers" style="max-height:190px;overflow:auto;margin-top:6px">
            ${groupMemberPickerHTML(draft.members)}
          </div>
        </div>
      </div>
      <div class="field">
        <span class="flabel">Баннер группы</span>
        <div class="hint" style="margin:-1px 0 8px">Загрузите фото из галереи — оно станет баннером группы.</div>
        <div id="bannerPicker">${bannerPickerHTML(draft)}</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-cancel-group>Отмена</button>
        <button type="submit" class="btn primary">${icon('plus')}<span>Создать группу</span></button>
      </div>
    </form>
  </div>`;

  const mount = (modal) => {
    const paintIcon = () => {
      const iconEl = $('#grpIcon', modal);
      const grad = GRADS[draft.grad];
      iconEl.style.setProperty('--g1', grad[0]);
      iconEl.style.setProperty('--g2', grad[1]);
      iconEl.innerHTML = groupIconInner(draft, monogram(draft.name || 'Новая группа'));
    };
    const paintText = () => {
      $('#grpPreviewName', modal).textContent = draft.name || 'Новая группа';
      $('#grpPreviewMeta', modal).textContent = groupPreviewMeta(draft);
      const desc = $('#grpPreviewDesc', modal);
      desc.textContent = draft.desc || 'Описание появится здесь.';
      desc.classList.toggle('muted', !draft.desc);
    };

    $('#grpName', modal).addEventListener('input', (event) => {
      draft.name = event.target.value;
      markFieldError(event.target, false);
      paintIcon();
      paintText();
    });
    const handleState = $('[data-handle-state]', modal);
    setHandleState(handleState, 'group', draft.handle);
    $('#grpHandle', modal).addEventListener('input', (event) => {
      const clean = cleanHandle(event.target.value);
      event.target.value = clean;
      draft.handle = clean;
      setHandleState(handleState, 'group', clean);
      if (clean.length >= 3 && handleTaken('group', clean)) {
        markFieldError(event.target, true, 'Такой адрес уже занят');
      } else {
        markFieldError(event.target, false);
      }
      paintText();
    });
    $('#grpDesc', modal).addEventListener('input', (event) => {
      draft.desc = event.target.value;
      paintText();
    });
    $$('[data-grad]', modal).forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.grad = Number(btn.dataset.grad);
        $$('[data-grad]', modal).forEach((b) => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        paintIcon();
      });
    });
    $$('.pick input', modal).forEach((input) => {
      input.addEventListener('change', () => {
        input.closest('.pick').classList.toggle('is-on', input.checked);
        draft.members = $$('.pick input:checked', modal).map((i) => i.value);
        paintText();
      });
    });

    const picker = $('#bannerPicker', modal);
    bindBannerPicks(picker, draft, () => {
      $('#grpBanner', modal).innerHTML = bannerHTML(draft.banner, '', draft.bannerImg);
    });
    $('[data-cancel-group]', modal).addEventListener('click', closeModal);
    bindGroupPhoto(modal, draft, paintIcon);

    $('#groupForm', modal).addEventListener('submit', async (event) => {
      event.preventDefault();
      const nameInput = $('#grpName', modal);
      const handleInput = $('#grpHandle', modal);
      const name = nameInput.value.trim();
      const handle = handleInput.value.trim().toLowerCase();
      let bad = false;
      if (name.length < 2 || name.length > 40) {
        markFieldError(nameInput, true, 'Название от 2 до 40 символов');
        bad = true;
      } else {
        markFieldError(nameInput, false);
      }
      if (!/^[a-z0-9-]{3,24}$/.test(handle)) {
        markFieldError(handleInput, true, 'Только латиница, цифры и дефис — 3–24 символа');
        bad = true;
      } else if (handleTaken('group', handle)) {
        markFieldError(handleInput, true, 'Такой адрес уже занят');
        bad = true;
      } else {
        markFieldError(handleInput, false);
      }
      if (bad) {
        toast('Проверьте название и адрес', 'warn');
        return;
      }
      const members = [state.me, ...$$('.pick input:checked', modal).map((i) => i.value)];
      const online = typeof NET !== 'undefined' && NET.online;
      if (online) {
        try {
          const convId = await NET.createGroup({
            name,
            handle,
            grad: draft.grad,
            icon: monogram(name),
            banner: draft.banner,
            bannerImg: draft.bannerImg || '',
            avatar: draft.avatar || '',
            desc: draft.desc.trim().slice(0, 220),
            access: $('#grpAccess', modal)?.value === 'open' ? 'open' : 'closed',
            requestsOn: Boolean($('#grpRequests', modal)?.checked),
            members: members.filter((id) => id !== state.me)
          });
          closeAllModals();
          renderAll();
          if (convId) openConversation(convId);
          toast('Группа создана', 'ok');
        } catch (error) {
          toast(error.message || 'Не удалось создать группу', 'warn');
        }
        return;
      }
      const conv = {
        id: uid('g'), type: 'group', name, handle, grad: draft.grad, icon: monogram(name), banner: draft.banner,
        bannerImg: draft.bannerImg || '',
        avatar: draft.avatar || '',
        desc: draft.desc.trim().slice(0, 220), members,
        access: $('#grpAccess', modal)?.value === 'open' ? 'open' : 'closed',
        requestsOn: Boolean($('#grpRequests', modal)?.checked),
        joinRequests: [],
        perms: { admins: { deleteMessages: true, removeMembers: true, acceptRequests: true } },
        roles: Object.fromEntries(members.map((id) => [id, id === state.me ? 'owner' : 'member'])),
        created: Date.now(),
        messages: [{
          id: uid('m'), author: state.me, t: Date.now(), sys: `${me().name} создала группу «${name}»`,
          text: '', att: [], react: {}, reply: null, pinned: false
        }],
        pinnedMsgs: [], pinned: false, unread: 0
      };
      state.conversations.push(conv);
      closeAllModals();
      renderAll();
      openConversation(conv.id);
      persist();
      toast('Группа создана', 'ok');
    });
  };

  openModal(html, { size: 'xl', label: 'Создать группу', onMount: mount });
}

function openGroupEditor(convId) {
  const conv = findConv(convId);
  if (!conv) return;
  if (!isOwner(conv)) {
    toast('Настройки группы доступны только владельцу', 'warn');
    return;
  }
  const access = conv.access || 'closed';
  const perms = conv.perms?.admins || {};
  const draft = {
    name: conv.name,
    handle: conv.handle || '',
    desc: conv.desc || '',
    banner: conv.banner || 'mono',
    bannerImg: conv.bannerImg || '',
    avatar: conv.avatar || '',
    grad: conv.grad || 0
  };

  const html = `<div class="modal-pad">
    <h2 class="modal-title">Настроить группу</h2>
    <p class="modal-sub">Название, описание и баннер сразу обновятся у всех участников.</p>
    <div class="editor-preview">
      <div class="ep-banner" id="grpBanner">${bannerHTML(draft.banner, '', draft.bannerImg)}</div>
      <div class="ep-row">
        <span class="gicon" id="grpIcon" style="--s:76px;border:4px solid #161618;--g1:${GRADS[draft.grad][0]};--g2:${GRADS[draft.grad][1]}">${groupIconInner(draft, conv.icon || monogram(conv.name))}</span>
        <div class="ep-id">
          <div class="ep-name" id="grpPreviewName">${esc(conv.name)}</div>
          <div class="ep-user" id="grpPreviewMeta">${esc(conv.members.length)} участников · @${esc(conv.handle || '')}</div>
        </div>
      </div>
      <div class="ep-bio" id="grpPreviewDesc">${esc(conv.desc || '')}</div>
    </div>
    <form id="groupForm" novalidate>
      <div class="form-grid">
        <div class="field">
          <label class="flabel" for="grpName">Название</label>
          <input class="input" id="grpName" maxlength="40" value="${esc(draft.name)}" autocomplete="off">
          <div class="err-text">Название от 2 до 40 символов</div>
        </div>
        <div class="field">
          <label class="flabel" for="grpHandle">Короткий адрес</label>
          <input class="input" id="grpHandle" maxlength="24" value="${esc(draft.handle)}" autocomplete="off">
          <div class="err-text">Только латиница, цифры и дефис — 3–24 символа</div>
          <div class="field-note" data-handle-state></div>
        </div>
      </div>
      <div class="field">
        <label class="flabel" for="grpDesc">Описание</label>
        <textarea class="input" id="grpDesc" maxlength="220">${esc(draft.desc)}</textarea>
      </div>
      <div class="field">
        <span class="flabel">Доступ</span>
        <input type="hidden" id="grpAccess" value="${esc(access)}">
        <div class="access-pick">
          <button type="button" class="access-opt ${access === 'closed' ? 'is-on' : ''}" data-access="closed">
            <b>${icon('lock')} Закрытая</b>
            <span>Вступление по ссылке и заявке.</span>
          </button>
          <button type="button" class="access-opt ${access === 'open' ? 'is-on' : ''}" data-access="open">
            <b>${icon('unlock')} Открытая</b>
            <span>Вступление по ссылке без заявки.</span>
          </button>
        </div>
      </div>
      <div class="field">
        <div class="switch-row">
          <span class="switch-meta">
            <b>Заявки на вступление</b>
            <span>Люди по ссылке подают заявку; принимают владелец и админы с правом.</span>
          </span>
          <input type="checkbox" id="grpRequests" ${conv.requestsOn !== false ? 'checked' : ''} aria-label="Заявки на вступление">
        </div>
      </div>
      <div class="field">
        <span class="flabel">Права админов</span>
        <div class="perms">
          <label class="perm-row">
            <span class="switch-meta"><b>Удалять чужие сообщения</b><span>Иначе админ удаляет только свои.</span></span>
            <input type="checkbox" id="permDelete" ${perms.deleteMessages !== false ? 'checked' : ''}>
          </label>
          <label class="perm-row">
            <span class="switch-meta"><b>Исключать участников</b><span>Кого можно убрать из группы.</span></span>
            <input type="checkbox" id="permRemove" ${perms.removeMembers !== false ? 'checked' : ''}>
          </label>
          <label class="perm-row">
            <span class="switch-meta"><b>Принимать заявки</b><span>Одобрять вступление по ссылке.</span></span>
            <input type="checkbox" id="permRequests" ${perms.acceptRequests !== false ? 'checked' : ''}>
          </label>
        </div>
      </div>
      <div class="field">
        <span class="flabel">Цвет иконки</span>
        <div class="swatches" id="grpSwatches">${swatchesHTML(draft.grad)}</div>
          <div class="bn-gallery-actions"><button type="button" class="btn sm primary" data-grp-photo>${icon('image')}<span>Фото из галереи</span></button><button type="button" class="btn sm" data-grp-photo-clear ${draft.avatar ? '' : 'disabled'}>Убрать</button></div>
      </div>
      <div class="field">
        <span class="flabel">Баннер группы</span>
        <div class="hint" style="margin:-1px 0 8px">Загрузите фото из галереи — оно станет баннером группы.</div>
        <div id="bannerPicker">${bannerPickerHTML(draft)}</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-cancel-group>Отмена</button>
        <button type="submit" class="btn primary">${icon('check')}<span>Сохранить</span></button>
      </div>
    </form>
  </div>`;

  const mount = (modal) => {
    const paintIcon = () => {
      const iconEl = $('#grpIcon', modal);
      const grad = GRADS[draft.grad];
      iconEl.style.setProperty('--g1', grad[0]);
      iconEl.style.setProperty('--g2', grad[1]);
      iconEl.innerHTML = groupIconInner(draft, monogram(draft.name || conv.name));
    };
    const paintText = () => {
      $('#grpPreviewName', modal).textContent = draft.name || conv.name;
      $('#grpPreviewMeta', modal).textContent = `${conv.members.length} участников · @${draft.handle || 'group'}`;
      $('#grpPreviewDesc', modal).textContent = draft.desc || 'Без описания';
    };
    $('#grpName', modal).addEventListener('input', (event) => {
      draft.name = event.target.value;
      markFieldError(event.target, false);
      paintIcon();
      paintText();
    });
    const handleState = $('[data-handle-state]', modal);
    setHandleState(handleState, 'group', draft.handle, conv.id);
    $('#grpHandle', modal).addEventListener('input', (event) => {
      const clean = cleanHandle(event.target.value);
      event.target.value = clean;
      draft.handle = clean;
      setHandleState(handleState, 'group', clean, conv.id);
      if (clean.length >= 3 && handleTaken('group', clean, conv.id)) {
        markFieldError(event.target, true, 'Такой адрес уже занят');
      } else {
        markFieldError(event.target, false);
      }
      paintText();
    });
    $('#grpDesc', modal).addEventListener('input', (event) => {
      draft.desc = event.target.value;
      paintText();
    });
    $$('[data-grad]', modal).forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.grad = Number(btn.dataset.grad);
        $$('[data-grad]', modal).forEach((b) => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        paintIcon();
      });
    });
    const picker = $('#bannerPicker', modal);
    bindBannerPicks(picker, draft, () => {
      $('#grpBanner', modal).innerHTML = bannerHTML(draft.banner, '', draft.bannerImg);
    });
    $('[data-cancel-group]', modal).addEventListener('click', closeModal);
    bindGroupPhoto(modal, draft, paintIcon);

    $('#groupForm', modal).addEventListener('submit', async (event) => {
      event.preventDefault();
      const nameInput = $('#grpName', modal);
      const handleInput = $('#grpHandle', modal);
      const name = nameInput.value.trim();
      const handle = handleInput.value.trim().toLowerCase();
      let bad = false;
      if (name.length < 2 || name.length > 40) {
        markFieldError(nameInput, true, 'Название от 2 до 40 символов');
        bad = true;
      } else {
        markFieldError(nameInput, false);
      }
      if (!/^[a-z0-9-]{3,24}$/.test(handle)) {
        markFieldError(handleInput, true, 'Только латиница, цифры и дефис — 3–24 символа');
        bad = true;
      } else if (handleTaken('group', handle, conv.id)) {
        markFieldError(handleInput, true, 'Такой адрес уже занят');
        bad = true;
      } else {
        markFieldError(handleInput, false);
      }
      if (bad) {
        toast('Проверьте название и адрес', 'warn');
        return;
      }
      const accessEl = $('#grpAccess', modal);
      const reqEl = $('#grpRequests', modal);
      const patch = {
        name,
        handle,
        desc: draft.desc.trim().slice(0, 220),
        banner: draft.banner,
        bannerImg: draft.bannerImg || '',
        avatar: draft.avatar || '',
        grad: draft.grad,
        icon: monogram(name),
        access: accessEl && accessEl.value === 'open' ? 'open' : 'closed',
        requestsOn: reqEl ? reqEl.checked : true,
        perms: {
          admins: {
            deleteMessages: Boolean($('#permDelete', modal)?.checked),
            removeMembers: Boolean($('#permRemove', modal)?.checked),
            acceptRequests: Boolean($('#permRequests', modal)?.checked)
          }
        }
      };
      if (typeof NET !== 'undefined' && NET.online) {
        try {
          await NET.updateGroup(conv, patch);
        } catch (error) {
          toast(error.message || 'Не удалось сохранить настройки группы', 'warn');
          return;
        }
      }
      Object.assign(conv, patch);
      closeAllModals();
      renderAll();
      openGroupCard(conv.id, 'members');
      persist();
      toast('Группа обновлена', 'ok');
    });
  };

  openModal(html, { size: 'lg', label: 'Настроить группу', onMount: mount });
}
