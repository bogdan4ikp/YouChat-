'use strict';

/* ---------- links ---------- */
function copyLink(url, label = 'Ссылка') {
  copyText(url);
}

/* ---------- selection ---------- */
function isPicking() {
  return Boolean(ui.sel);
}

function selectedIds() {
  return ui.sel ? Array.from(ui.sel) : [];
}

function setPickingClasses() {
  const box = $('#messages');
  if (box) box.classList.toggle('is-picking', Boolean(ui.sel));
}

function renderSelectionBar() {
  const bar = $('#selBar');
  if (!bar) return;
  setPickingClasses();
  if (!ui.sel) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  const n = ui.sel.size;
  bar.hidden = false;
  bar.innerHTML = `
    <button type="button" class="icon-btn xs" data-sel-cancel aria-label="Отменить выбор">${icon('close')}</button>
    <span class="sel-count">Выбрано: <b>${n}</b></span>
    <button type="button" class="btn sm" data-sel-forward ${n ? '' : 'disabled'}>${icon('forward')}<span>Переслать</span></button>
    <button type="button" class="btn sm danger" data-sel-delete ${n ? '' : 'disabled'}>${icon('trash')}<span>Удалить</span></button>`;
}

function startSelection(id) {
  ui.sel = new Set();
  if (id) ui.sel.add(id);
  renderSelectionBar();
  renderMessages(activeConv());
}

function toggleSelection(id) {
  if (!ui.sel) return;
  if (ui.sel.has(id)) ui.sel.delete(id);
  else ui.sel.add(id);
  renderSelectionBar();
  renderMessages(activeConv());
}

function cancelSelection() {
  if (!ui.sel) return;
  ui.sel = null;
  renderSelectionBar();
  renderMessages(activeConv());
}

function selectedMessages() {
  const conv = activeConv();
  if (!conv || !ui.sel) return [];
  return conv.messages.filter((m) => ui.sel.has(m.id) && !m.hiddenFor?.includes(state.me));
}

/* ---------- delete ---------- */
function deleteMessages(conv, msgs, opts = {}) {
  if (!conv || !msgs.length) return;
  let forAll = 0;
  let forMe = 0;
  msgs.forEach((m) => {
    if (m.sys) return;
    if (canDeleteForAll(conv, m)) {
      m.deleted = true;
      m.text = '';
      m.att = [];
      m.react = {};
      m.editedAt = null;
      m.hiddenFor = [];
      forAll += 1;
      conv.pinnedMsgs = (conv.pinnedMsgs || []).filter((id) => id !== m.id);
      if (ui.replyTo === m.id) ui.replyTo = null;
    } else {
      m.hiddenFor = m.hiddenFor || [];
      if (!m.hiddenFor.includes(state.me)) m.hiddenFor.push(state.me);
      forMe += 1;
    }
  });
  renderMessages(conv);
  renderSidebar();
  renderIntro(conv);
  renderReply();
  persist();
  if (typeof NET !== 'undefined' && NET.online) NET.deleteMessages(conv, msgs);
  const parts = [];
  if (forAll) parts.push(`у всех: ${forAll}`);
  if (forMe) parts.push(`только у себя: ${forMe}`);
  toast(`Удалено${parts.length ? ' · ' + parts.join(', ') : ''}`, 'ok');
}

function confirmDeleteMessages(msgs) {
  const conv = activeConv();
  if (!conv || !msgs.length) return;
  const allMine = msgs.every((m) => canDeleteForAll(conv, m));
  openConfirm({
    title: msgs.length === 1 ? 'Удалить сообщение?' : `Удалить сообщений: ${msgs.length}?`,
    text: allMine
      ? 'Сообщения исчезнут у всех участников беседы. Отменить действие нельзя.'
      : 'Свои сообщения удалятся у всех, чужие — только у вас.',
    confirmLabel: 'Удалить',
    danger: true,
    onConfirm: () => {
      deleteMessages(conv, msgs);
      cancelSelection();
      closePopover();
    }
  });
}

/* ---------- forwarding ---------- */
function forwardMessages(msgs) {
  if (!msgs.length) return;
  const convs = state.conversations.slice().sort((a, b) => lastTs(b) - lastTs(a));
  if (!convs.length) {
    toast('Пока нет других бесед — создайте группу', 'warn');
    return;
  }
  const rows = convs.map((c) => `
    <button type="button" class="pick" data-fwd-to="${c.id}">
      ${convAvatarHTML(c, 34)}
      <span class="pick-meta">
        <span class="pick-name">${esc(convTitle(c))}</span>
        <span class="pick-sub">${c.type === 'group' ? membersLabel(c.members.length) : 'личная переписка'}</span>
      </span>
      ${icon('chev-right')}
    </button>`).join('');
  const html = `<div class="modal-pad">
    <h2 class="modal-title">Переслать ${msgs.length === 1 ? 'сообщение' : `сообщений: ${msgs.length}`}</h2>
    <p class="modal-sub">Выберите беседу — сообщения отправятся от вашего имени.</p>
    <div class="mem-list">${rows}</div>
  </div>`;
  openModal(html, {
    size: 'sm',
    label: 'Переслать сообщения',
    onMount: (modal) => {
      $$('[data-fwd-to]', modal).forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = findConv(btn.dataset.fwdTo);
          if (!target) return;
          const fresh = msgs.map((m) => {
            const copy = {
              id: uid('m'),
              author: state.me,
              t: Date.now(),
              text: m.text || '',
              att: JSON.parse(JSON.stringify(m.att || [])),
              react: {},
              reply: null,
              pinned: false,
              forwardedFrom: person(m.author).name
            };
            target.messages.push(copy);
            return copy;
          });
          if (typeof NET !== 'undefined' && NET.online) fresh.forEach((copy) => NET.sendMessage(target, copy));
          closeAllModals();
          cancelSelection();
          renderSidebar();
          const cur = activeConv();
          if (cur) { renderMessages(cur); renderIntro(cur); }
          persist();
          toast(`Переслано в «${convTitle(target)}»`, 'ok');
        });
      });
    }
  });
}

/* ---------- editing ---------- */
function renderEditChip() {
  const chip = $('#editChip');
  if (!chip) return;
  const conv = activeConv();
  const msg = ui.editing && conv ? conv.messages.find((m) => m.id === ui.editing) : null;
  if (!msg) {
    ui.editing = null;
    chip.hidden = true;
    chip.innerHTML = '';
    return;
  }
  chip.hidden = false;
  chip.innerHTML = `${icon('edit')}<span>Изменение сообщения · <b>${esc(fmtTime(msg.t))}</b></span>
    <button type="button" class="icon-btn xs" data-edit-cancel aria-label="Отменить изменение">${icon('close')}</button>`;
}

function startEdit(msgId) {
  const conv = activeConv();
  const msg = conv?.messages.find((m) => m.id === msgId);
  if (!msg || !canEditMessage(msg)) return;
  ui.editing = msgId;
  ui.replyTo = null;
  renderReply();
  const input = $('#composerInput');
  input.value = msg.text || '';
  resizeComposer();
  renderEditChip();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  closePopover();
}

function cancelEdit() {
  ui.editing = null;
  const input = $('#composerInput');
  if (input) input.value = '';
  renderEditChip();
  resizeComposer();
}

function commitEdit(text) {
  const conv = activeConv();
  if (!conv || !ui.editing) return false;
  const msg = conv.messages.find((m) => m.id === ui.editing);
  if (!msg || !canEditMessage(msg)) { cancelEdit(); return false; }
  msg.text = text;
  msg.editedAt = Date.now();
  ui.editing = null;
  $('#composerInput').value = '';
  renderEditChip();
  resizeComposer();
  renderMessages(conv);
  renderSidebar();
  persist();
  if (typeof NET !== 'undefined' && NET.online) NET.editMessage(conv, msg, text);
  toast('Сообщение изменено', 'ok');
  return true;
}

/* ---------- message playback ---------- */
function toggleVoice(btn) {
  const wrap = btn.closest('.voice');
  const audio = wrap?.querySelector('audio');
  if (!audio) return;
  if (audio.paused) {
    document.querySelectorAll('.voice audio').forEach((a) => { if (a !== audio) { a.pause(); a.closest('.voice')?.classList.remove('playing'); } });
    audio.play().catch(() => toast('Не удалось воспроизвести запись', 'warn'));
    wrap.classList.add('playing');
    btn.innerHTML = icon('pause');
  } else {
    audio.pause();
    wrap.classList.remove('playing');
    btn.innerHTML = icon('play');
  }
}

function toggleNote(node) {
  const video = node.querySelector('video');
  if (!video) return;
  if (video.paused) {
    document.querySelectorAll('.note video').forEach((v) => { if (v !== video) { v.pause(); v.closest('.note')?.classList.add('is-paused'); } });
    video.play().catch(() => toast('Не удалось воспроизвести кружок', 'warn'));
    node.classList.remove('is-paused');
  } else {
    video.pause();
    node.classList.add('is-paused');
  }
}

/* ---------- recording ---------- */
const recState = {
  active: false, starting: false, abort: false, locked: false, stopping: false,
  kind: 'voice', stream: null, recorder: null, chunks: [],
  startedAt: 0, timer: null, facing: 'user', save: true,
  replaceId: null, mirror: false
};

function pickMime(kind) {
  const list = kind === 'note'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return list.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
}

function recorderHTML() {
  const hintIdle = recState.replaceId
    ? 'Потяните вверх, чтобы зафиксировать запись'
    : 'Удерживайте · свайп вверх фиксирует';
  if (recState.kind === 'note') {
    return `<div class="rec-round"><video autoplay muted playsinline></video>
        <span class="rec-badge"><span class="rec-dot"></span>запись</span>
        <span class="rec-timer">0:00 / ${fmtDur(REC_LIMIT)}</span>
      </div>
      <div class="rec-round-label">Кружок · камера ${recState.facing === 'user' ? 'фронтальная' : 'основная'}</div>
      <span class="rec-hint" data-rec-hint>${hintIdle}</span>
      <div class="rec-actions">
        <button type="button" class="rec-btn" data-rec-flip aria-label="Переключить камеру" data-tip="Переключить камеру">${icon('switch')}</button>
        <button type="button" class="rec-btn danger" data-rec-cancel aria-label="Отменить запись">${icon('close')}</button>
        <button type="button" class="rec-btn primary" data-rec-send aria-label="Отправить кружок">${icon('arrow-up')}</button>
      </div>`;
  }
  return `<span class="rec-dot"></span>
    <span class="rec-time">0:00</span>
    <span class="rec-limit">/ ${fmtDur(REC_LIMIT)}</span>
    <span class="rec-hint" data-rec-hint>${hintIdle}</span>
    <div class="rec-actions">
      <button type="button" class="rec-btn danger" data-rec-cancel aria-label="Отменить запись">${icon('trash')}</button>
      <button type="button" class="rec-btn primary" data-rec-send aria-label="Отправить голосовое">${icon('arrow-up')}</button>
    </div>`;
}

function recHintText(locked) {
  if (locked) return 'Зафиксировано — отправьте кнопкой';
  if (recState.replaceId) return 'Потяните вверх, чтобы зафиксировать запись';
  return 'Удерживайте · свайп вверх фиксирует';
}

function setRecLocked(locked) {
  recState.locked = locked;
  const box = $('#recorder');
  if (!box || box.hidden) return;
  box.classList.toggle('is-locked', locked);
  const hint = box.querySelector('[data-rec-hint]');
  if (hint) hint.textContent = recHintText(locked);
}

function showRecorder() {
  const box = $('#recorder');
  const conv = activeConv();
  if (!conv) return;
  box.hidden = false;
  box.className = 'recorder ' + (recState.kind === 'note' ? 'round-mode' : 'voice-mode');
  box.innerHTML = recorderHTML();
  if (recState.kind === 'note') {
    const video = box.querySelector('video');
    if (video) video.srcObject = recState.stream;
    const wrap = box.querySelector('.rec-round');
    if (wrap) wrap.classList.toggle('mirror-off', recState.facing !== 'user');
  }
  setRecLocked(recState.locked);
  $('#composerArea').classList.add('is-recording');
}

function hideRecorder() {
  const box = $('#recorder');
  if (!box) return;
  box.hidden = true;
  box.innerHTML = '';
  $('#composerArea').classList.remove('is-recording');
}

function tickRecorder() {
  const el = $('.rec-time') || $('.rec-timer');
  const elapsed = (Date.now() - recState.startedAt) / 1000;
  if (el) {
    el.textContent = recState.kind === 'note'
      ? `${fmtDur(elapsed)} / ${fmtDur(REC_LIMIT)}`
      : fmtDur(elapsed);
  }
  if (elapsed >= REC_LIMIT && recState.active) {
    stopRecording(true);
    toast('Лимит записи — 1 минута', 'ok');
  }
}

async function startRecording(kind, opts = {}) {
  if (recState.active || recState.starting) return;
  if (!activeConv()) { toast('Сначала выберите беседу', 'warn'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Запись не поддерживается этим браузером', 'warn');
    return;
  }
  recState.kind = kind;
  recState.facing = 'user';
  recState.replaceId = opts.replaceId || null;
  recState.locked = false;
  recState.abort = false;
  recState.stopping = false;
  recState.save = true;
  recState.starting = true;
  try {
    const constraints = kind === 'note'
      ? { audio: true, video: { facingMode: recState.facing, width: { ideal: 720 }, height: { ideal: 720 } } }
      : { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (recState.abort) {
      recState.abort = false;
      recState.starting = false;
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const mime = pickMime(kind);
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recState.stream = stream;
    recState.recorder = recorder;
    recState.chunks = [];
    recState.startedAt = Date.now();
    recState.mirror = kind === 'note' && recState.facing === 'user';
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) recState.chunks.push(event.data); };
    recorder.onstop = finishRecording;
    recorder.start(250);
    recState.active = true;
    recState.starting = false;
    showRecorder();
    tickRecorder();
    recState.timer = setInterval(tickRecorder, 250);
  } catch (error) {
    recState.starting = false;
    toast(kind === 'note' ? 'Нет доступа к камере' : 'Нет доступа к микрофону', 'warn');
    cleanupRecording();
  }
}

function stopRecording(save = true) {
  if (!recState.active || !recState.recorder || recState.stopping) return;
  recState.stopping = true;
  recState.save = save;
  try { recState.recorder.stop(); } catch (error) { finishRecording(); }
}

async function finishRecording() {
  const dur = Math.min(REC_LIMIT, Math.max(1, Math.round((Date.now() - recState.startedAt) / 1000)));
  const save = recState.save;
  const kind = recState.kind;
  const replaceId = recState.replaceId;
  const mirror = recState.mirror;
  const mime = recState.recorder?.mimeType || '';
  const blob = recState.chunks.length ? new Blob(recState.chunks, { type: mime }) : null;
  cleanupRecording();
  hideRecorder();
  if (!save || !blob) return;
  const conv = activeConv();
  if (!conv) return;
  let url;
  if (typeof NET !== 'undefined' && NET.online) {
    try {
      url = await NET.uploadBlob(blob, kind === 'note' ? 'video.webm' : 'voice.webm');
    } catch (error) {
      toast(kind === 'note' ? 'Кружок не загрузился на сервер' : 'Голосовое не загрузилось на сервер', 'warn');
      return;
    }
  } else {
    url = URL.createObjectURL(blob);
  }
  if (replaceId) {
    const msg = conv.messages.find((m) => m.id === replaceId);
    const target = msg?.att?.find((a) => a.k === (kind === 'note' ? 'note' : 'voice'));
    if (msg && target) {
      target.src = url;
      target.dur = dur;
      target.session = true;
      target.mirror = mirror;
      msg.editedAt = Date.now();
      renderMessages(conv);
      renderSidebar();
      persist();
      toast(kind === 'note' ? 'Кружок перезаписан' : 'Голосовое перезаписано', 'ok');
      return;
    }
  }
  const att = kind === 'note'
    ? { aid: uid('a'), k: 'note', src: url, dur, session: true, mirror, title: 'Кружок' }
    : { aid: uid('a'), k: 'voice', src: url, dur, session: true, title: 'Голосовое' };
  ui.pending.push(att);
  renderPending();
  sendCurrent();
}

function cleanupRecording() {
  if (recState.timer) clearInterval(recState.timer);
  recState.timer = null;
  if (recState.stream) recState.stream.getTracks().forEach((track) => track.stop());
  recState.stream = null;
  recState.recorder = null;
  recState.chunks = [];
  recState.active = false;
  recState.starting = false;
  recState.abort = false;
  recState.locked = false;
  recState.stopping = false;
  recState.replaceId = null;
  recState.mirror = false;
  recState.save = true;
}

async function flipCamera() {
  if (!recState.active || recState.kind !== 'note' || !recState.stream) return;
  const track = recState.stream.getVideoTracks()[0];
  if (!track) return;
  const next = recState.facing === 'user' ? 'environment' : 'user';
  try {
    await track.applyConstraints({ facingMode: { ideal: next } });
    recState.facing = next;
    recState.mirror = next === 'user';
    const label = $('.rec-round-label');
    if (label) label.textContent = `Кружок · камера ${next === 'user' ? 'фронтальная' : 'основная'}`;
    const wrap = $('.rec-round');
    if (wrap) wrap.classList.toggle('mirror-off', next !== 'user');
    toast('Камера переключена', 'ok');
  } catch (error) {
    toast('Вторая камера не найдена', 'warn');
  }
}

/* ---------- roles ---------- */
function refreshGroupCard(convId, tab = 'members') {
  closeAllModals();
  openGroupCard(convId, tab);
}

function setMemberRole(conv, personId, role) {
  if (!conv || conv.type !== 'group' || !isOwner(conv) || personId === state.me) return;
  if (!['admin', 'member'].includes(role) || !conv.members.includes(personId)) { toast('Нельзя изменить роль этого пользователя', 'warn'); return; }
  if (conv.roles?.[personId] === 'owner') { toast('Нельзя изменить роль владельца', 'warn'); return; }
  conv.roles = conv.roles || {};
  conv.roles[personId] = role;
  logAdmin(conv, role === 'admin' ? `Назначен админом: ${person(personId).name}` : `Снят с роли админа: ${person(personId).name}`);
  conv.messages.push({
    id: uid('m'), author: state.me, t: Date.now(),
    sys: role === 'admin' ? `${me().name} назначил(а) ${person(personId).name} админом` : `${me().name} снял(а) ${person(personId).name} с роли админа`,
    text: '', att: [], react: {}, reply: null, pinned: false
  });
  persist();
  renderMessages(conv);
  refreshGroupCard(conv.id, 'members');
  if (typeof NET !== 'undefined' && NET.online) {
    NET.setRole(conv, personId, role).catch((error) => { if (error.status !== 401) toast(error.message || 'Не удалось изменить роль', 'warn'); });
  }
  toast(role === 'admin' ? 'Назначен админом' : 'Права админа сняты', 'ok');
}

function kickMember(conv, personId) {
  openConfirm({
    title: `Исключить ${person(personId).name}?`,
    text: 'Участник потеряет доступ к группе и её истории.',
    confirmLabel: 'Исключить',
    danger: true,
    onConfirm: () => {
      if (!canManageMember(conv, personId)) { toast('Недостаточно прав', 'warn'); return; }
      logAdmin(conv, `Исключён(а): ${person(personId).name}`);
      conv.members = conv.members.filter((id) => id !== personId);
      if (conv.roles) delete conv.roles[personId];
      conv.messages.push({
        id: uid('m'), author: state.me, t: Date.now(),
        sys: `${person(personId).name} исключён(а) из группы`, text: '', att: [], react: {}, reply: null, pinned: false
      });
      persist();
      renderMessages(conv);
      renderSidebar();
      refreshGroupCard(conv.id, 'members');
      if (typeof NET !== 'undefined' && NET.online) {
        NET.kickMember(conv, personId).catch((error) => { if (error.status !== 401) toast(error.message || 'Не удалось исключить участника', 'warn'); });
      }
      toast('Участник исключён', 'ok');
    }
  });
}

function transferOwnership(conv, personId) {
  if (!conv || conv.type !== 'group' || !isOwner(conv) || personId === state.me || !conv.members.includes(personId)) {
    toast('Передать владение можно только участнику этой группы', 'warn'); return;
  }
  openConfirm({
    title: 'Передать владение?',
    text: `${person(personId).name} станет владельцем группы, а вы — админом. Вернуть права сможет только новый владелец.`,
    confirmLabel: 'Передать',
    danger: true,
    onConfirm: () => {
      if (!isOwner(conv) || !conv.members.includes(personId) || personId === state.me) { toast('Передача владения отменена: изменились права или состав группы', 'warn'); return; }
      conv.roles = conv.roles || {};
      Object.keys(conv.roles).forEach((id) => { if (conv.roles[id] === 'owner') conv.roles[id] = 'admin'; });
      conv.roles[state.me] = 'admin';
      conv.roles[personId] = 'owner';
      logAdmin(conv, `Владение передано: ${person(personId).name}`);
      conv.messages.push({
        id: uid('m'), author: state.me, t: Date.now(),
        sys: `${person(personId).name} теперь владелец группы`, text: '', att: [], react: {}, reply: null, pinned: false
      });
      persist();
      renderMessages(conv);
      refreshGroupCard(conv.id, 'members');
      if (typeof NET !== 'undefined' && NET.online) {
        NET.transfer(conv, personId).catch((error) => { if (error.status !== 401) toast(error.message || 'Не удалось передать владение', 'warn'); });
      }
      toast('Владение передано', 'ok');
    }
  });
}

function openMemberMenu(anchor, convId, personId) {
  const conv = findConv(convId);
  if (!conv || personId === state.me) return;
  const targetRole = conv.roles?.[personId] || 'member';
  const items = [];
  if (isOwner(conv)) {
    if (targetRole !== 'owner') {
      items.push(targetRole === 'admin'
        ? { id: 'demote', label: 'Снять админа', icon: 'shield', onClick: () => setMemberRole(conv, personId, 'member') }
        : { id: 'promote', label: 'Назначить админом', icon: 'shield', onClick: () => setMemberRole(conv, personId, 'admin') });
      items.push({ id: 'transfer', label: 'Передать владение', icon: 'crown', onClick: () => transferOwnership(conv, personId) });
    }
  }
  if (canManageMember(conv, personId)) {
    if (items.length) items.push('sep');
    items.push({ id: 'kick', label: 'Исключить из группы', icon: 'logout', danger: true, onClick: () => kickMember(conv, personId) });
  }
  if (!items.length) return;
  openMenu(anchor, items);
}

/* ---------- join requests ---------- */
function simulateRequest(convId) {
  const conv = findConv(convId);
  if (!conv || !isGroupAdmin(conv)) { toast('Недостаточно прав', 'warn'); return; }
  toast('Заявки от других устройств требуют серверной версии YouChat', 'warn');
}

function decideRequest(convId, reqId, accept) {
  const conv = findConv(convId);
  if (!conv) return;
  if (!adminPerm(conv, 'acceptRequests')) { toast('Недостаточно прав', 'warn'); return; }
  const req = (conv.joinRequests || []).find((r) => r.id === reqId);
  if (req && (!req.personId || conv.members.includes(req.personId) || !state.people[req.personId])) {
    conv.joinRequests = (conv.joinRequests || []).filter((r) => r.id !== reqId); persist(); toast('Некорректная заявка удалена', 'warn'); refreshGroupCard(conv.id, 'requests'); return;
  }
  if (req) logAdmin(conv, `${accept ? 'Принята' : 'Отклонена'} заявка: ${person(req.personId).name}`);
  conv.joinRequests = (conv.joinRequests || []).filter((r) => r.id !== reqId);
  if (req && accept) {
    if (!conv.members.includes(req.personId)) conv.members.push(req.personId);
    conv.roles = conv.roles || {};
    conv.roles[req.personId] = conv.roles[req.personId] || 'member';
    conv.messages.push({
      id: uid('m'), author: req.personId, t: Date.now(),
      sys: `${person(req.personId).name} вступил(а) в группу по заявке`, text: '', att: [], react: {}, reply: null, pinned: false
    });
    toast('Заявка принята', 'ok');
  } else if (req) {
    toast('Заявка отклонена', 'ok');
  }
  persist();
  renderMessages(conv);
  renderSidebar();
  refreshGroupCard(conv.id, 'requests');
  if (typeof NET !== 'undefined' && NET.online) {
    NET.decideRequest(conv, reqId, accept).catch((error) => { if (error.status !== 401) toast(error.message || 'Не удалось обработать заявку', 'warn'); });
  }
}

function acceptAllRequests(convId) {
  const conv = findConv(convId);
  if (!conv || !adminPerm(conv, 'acceptRequests')) { toast('Недостаточно прав', 'warn'); return; }
  const list = (conv.joinRequests || []).filter((r) => r.personId && state.people[r.personId] && !conv.members.includes(r.personId));
  if (!list.length) { toast('Нет заявок для обработки', 'warn'); return; }
  list.forEach((r) => {
    if (!conv.members.includes(r.personId)) conv.members.push(r.personId);
    conv.roles[r.personId] = conv.roles[r.personId] || 'member';
    logAdmin(conv, `Принята заявка: ${person(r.personId).name}`);
  });
  conv.joinRequests = [];
  conv.messages.push({ id: uid('m'), author: state.me, t: Date.now(), sys: `Принято заявок: ${list.length}`, text: '', att: [], react: {}, reply: null, pinned: false });
  persist();
  renderMessages(conv);
  renderSidebar();
  refreshGroupCard(conv.id, 'admin');
  if (typeof NET !== 'undefined' && NET.online) {
    NET.acceptAllRequests(conv).catch((error) => { if (error.status !== 401) toast(error.message || 'Не удалось принять заявки', 'warn'); });
  }
  toast(`Принято заявок: ${list.length}`, 'ok');
}

const PERM_LABELS = { deleteMessages: 'удалять сообщения', removeMembers: 'исключать участников', acceptRequests: 'принимать заявки' };
function setAdminPerm(convId, key, value) {
  const conv = findConv(convId);
  if (!conv || !isOwner(conv) || !PERM_LABELS[key]) return;
  conv.perms = conv.perms || { admins: {} };
  conv.perms.admins[key] = value;
  logAdmin(conv, `Права админов: «${PERM_LABELS[key]}» — ${value ? 'вкл' : 'выкл'}`);
  persist();
  if (typeof NET !== 'undefined' && NET.online) {
    NET.updateGroup(conv, {
      name: conv.name,
      handle: conv.handle,
      desc: conv.desc || '',
      grad: conv.grad,
      banner: conv.banner,
      bannerImg: conv.bannerImg || '',
      avatar: conv.avatar || '',
      access: conv.access,
      requestsOn: conv.requestsOn !== false,
      perms: conv.perms
    }).catch((error) => { if (error.status !== 401) toast(error.message || 'Не удалось сохранить права', 'warn'); });
  }
}

/* ---------- new chat ---------- */
function openNewChat() {
  if (typeof NET !== 'undefined' && NET.online) {
    NET.openPeopleSearch('');
    return;
  }
  const people = Object.values(state.people)
    .filter((p) => p.id !== state.me)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const rows = people.map((p) => `
    <button type="button" class="pick" data-new-dm="${p.id}">
      ${avatarHTML(p, 34, { status: true, border: 'var(--bg-3)' })}
      <span class="pick-meta">
        <span class="pick-name">${esc(p.name)}</span>
        <span class="pick-sub">@${esc(p.username)} · ${statusText(p)}</span>
      </span>
    </button>`).join('');
  openModal(`<div class="modal-pad">
    <h2 class="modal-title">Новая переписка</h2>
    <p class="modal-sub">${people.length ? 'Выберите человека — откроется личный чат.' : 'Пока здесь никого нет. Люди появятся, когда к вам присоединятся.'}</p>
    <div class="mem-list">${rows}</div>
  </div>`, {
    size: 'sm',
    label: 'Новая переписка',
    onMount: (modal) => {
      $$('[data-new-dm]', modal).forEach((btn) => btn.addEventListener('click', () => openDM(btn.dataset.newDm)));
    }
  });
}

/* ---------- binding ---------- */
let hold = null;

function bindRecordButton(btn, kind) {
  if (!btn) return;
  btn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (recState.active || recState.starting) return;
    event.preventDefault();
    try { btn.setPointerCapture(event.pointerId); } catch (error) {}
    hold = { kind, y: event.clientY, at: Date.now(), pointerId: event.pointerId };
    startRecording(kind);
  });
  btn.addEventListener('pointermove', (event) => {
    if (!hold || hold.pointerId !== event.pointerId || recState.locked) return;
    if (hold.y - event.clientY < 44) return;
    setRecLocked(true);
    if (navigator.vibrate) navigator.vibrate(8);
    toast('Запись зафиксирована — жмите «Отправить»', 'ok');
  });
  const release = (event) => {
    if (!hold) return;
    if (event && event.pointerId !== undefined && event.pointerId !== hold.pointerId) return;
    const locked = recState.locked;
    const quick = Date.now() - hold.at < 320;
    hold = null;
    if (locked) return;
    if (recState.starting && !recState.active) { recState.abort = true; return; }
    if (!recState.active) return;
    if (quick) {
      stopRecording(false);
      toast('Удерживайте кнопку, чтобы записать', 'warn');
      return;
    }
    stopRecording(true);
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    if (recState.active) stopRecording(true);
    else startRecording(kind);
  });
}

function bindSocial() {
  bindRecordButton($('#btnMicRec'), 'voice');
  bindRecordButton($('#btnRound'), 'note');

  const rec = $('#recorder');
  if (rec) rec.addEventListener('click', (event) => {
    if (event.target.closest('[data-rec-cancel]')) { stopRecording(false); return; }
    if (event.target.closest('[data-rec-send]')) { stopRecording(true); return; }
    if (event.target.closest('[data-rec-flip]')) flipCamera();
  });

  const sel = $('#selBar');
  if (sel) sel.addEventListener('click', (event) => {
    if (event.target.closest('[data-sel-cancel]')) { cancelSelection(); return; }
    if (event.target.closest('[data-sel-forward]')) { forwardMessages(selectedMessages()); return; }
    if (event.target.closest('[data-sel-delete]')) { confirmDeleteMessages(selectedMessages()); }
  });

  const editChip = $('#editChip');
  if (editChip) editChip.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-cancel]')) cancelEdit();
  });

  const messages = $('#messages');
  if (messages) {
    messages.addEventListener('click', (event) => {
      const voiceBtn = event.target.closest('[data-voice-btn]');
      if (voiceBtn) { event.stopPropagation(); toggleVoice(voiceBtn); return; }
      const note = event.target.closest('.note');
      if (note) { event.stopPropagation(); toggleNote(note); return; }
      if (event.target.closest('[data-profile],[data-media-aid],.msg-reply,[data-jump],[data-react],[data-react-add],[data-reply],[data-msg-more],a,button,audio,video')) return;
      const msgNode = event.target.closest('.msg');
      if (!msgNode || msgNode.classList.contains('is-deleted')) return;
      if (suppressNextClick) { suppressNextClick = false; return; }
      if (!ui.sel && window.matchMedia('(pointer:fine)').matches) return;
      if (String(window.getSelection && window.getSelection()).trim()) return;
      if (ui.sel) toggleSelection(msgNode.dataset.msg);
      else openMessageMenu(msgNode, msgNode.dataset.msg);
    });

    messages.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || ui.sel) return;
      if (event.target.closest('button,a,audio,video,input,textarea,[data-media-aid],.msg-tools')) return;
      const msgNode = event.target.closest('.msg');
      if (!msgNode || msgNode.classList.contains('is-deleted')) return;
      pressStart = { x: event.clientX, y: event.clientY };
      pressTimer = setTimeout(() => {
        suppressNextClick = true;
        openMessageMenu(msgNode, msgNode.dataset.msg);
      }, 520);
    });
    messages.addEventListener('contextmenu', (event) => {
      const msgNode = event.target.closest('.msg');
      if (!msgNode || msgNode.classList.contains('is-deleted') || event.target.closest('a,input,textarea')) return;
      event.preventDefault();
      clearTimeout(pressTimer);
      if (!ui.sel) openMessageMenu(msgNode, msgNode.dataset.msg);
    });
    messages.addEventListener('pointermove', (event) => {
      if (!pressStart) return;
      if (Math.abs(event.clientX - pressStart.x) > 8 || Math.abs(event.clientY - pressStart.y) > 8) clearTimeout(pressTimer);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
      messages.addEventListener(type, () => clearTimeout(pressTimer));
    });
  }

  document.addEventListener('click', (event) => {
    const acc = event.target.closest('[data-access]');
    if (acc) {
      const modal = acc.closest('.modal');
      if (modal) {
        $$('[data-access]', modal).forEach((b) => b.classList.toggle('is-on', b === acc));
        const hidden = $('#grpAccess', modal);
        if (hidden) hidden.value = acc.dataset.access;
        const req = $('#grpRequests', modal);
        if (req) {
          if (acc.dataset.access === 'open') { req.checked = false; req.disabled = true; }
          else req.disabled = false;
        }
      }
      return;
    }
    const newChat = event.target.closest('[data-new-chat]');
    if (newChat) { openNewChat(); return; }
    const memBtn = event.target.closest('[data-member-menu]');
    if (memBtn) {
      const [convId, personId] = memBtn.dataset.memberMenu.split('|');
      openMemberMenu(memBtn, convId, personId);
      return;
    }
    const selBtn = event.target.closest('[data-select-msg]');
    if (selBtn) { startSelection(selBtn.dataset.selectMsg); closePopover(); }
  });

  document.addEventListener('ended', (event) => {
    if (event.target.tagName === 'AUDIO') {
      const wrap = event.target.closest('.voice');
      if (wrap) {
        wrap.classList.remove('playing');
        const btn = wrap.querySelector('[data-voice-btn]');
        if (btn) btn.innerHTML = icon('play');
      }
    }
    if (event.target.tagName === 'VIDEO') {
      const note = event.target.closest('.note');
      if (note) note.classList.add('is-paused');
    }
  }, true);

}

let pressTimer = null;
let pressStart = null;
let suppressNextClick = false;
