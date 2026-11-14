'use strict';

function openSearchPanel() {
  if (!activeConv()) return;
  $('#msgSearchWrap').hidden = false;
  $('.chat-head').classList.add('searching');
  $('#msgSearch').focus();
  $('#msgSearch').select();
}

function closeSearchPanel() {
  $('#msgSearchWrap').hidden = true;
  $('.chat-head').classList.remove('searching');
  $('#msgSearch').value = '';
  ui.msgQuery = '';
  const conv = activeConv();
  if (conv) renderMessages(conv);
  $('#msgSearchCount').textContent = '';
}

function bindEvents() {
  $('#convFilter').addEventListener('input', (event) => {
    ui.filter = event.target.value;
    renderSidebar();
  });
  $('#convFilter').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.target.value = '';
      ui.filter = '';
      renderSidebar();
      event.target.blur();
    }
  });

  $('#convList').addEventListener('click', (event) => {
    const create = event.target.closest('[data-create-group]');
    if (create) { openCreateGroup(); return; }
    const menuBtn = event.target.closest('[data-conv-menu]');
    if (menuBtn) {
      const conv = findConv(menuBtn.dataset.convMenu);
      if (conv) openConversationMenu(conv, menuBtn);
      return;
    }
    const item = event.target.closest('[data-conv]');
    if (item) openConversation(item.dataset.conv);
  });
  $('#convList').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('[data-conv]');
    if (!item) return;
    event.preventDefault();
    openConversation(item.dataset.conv);
  });

  $('#railAll').addEventListener('click', () => setView('all'));
  $('#railGroups').addEventListener('click', () => setView('groups'));
  $('#railCreate').addEventListener('click', openCreateGroup);
  $('#railHome').addEventListener('click', () => setView('all'));
  $('#railShortcuts').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-rail-conv]');
    if (btn) openConversation(btn.dataset.railConv);
  });
  $('#railMe')?.addEventListener('click', (event) => openMeMenu(event.currentTarget));
  $('#brandBtn').addEventListener('click', () => setView('all'));
  $('#btnNewGroup').addEventListener('click', openCreateGroup);

  $('#meCard').addEventListener('click', (event) => openMeMenu(event.currentTarget));
  $('#btnPrefs').addEventListener('click', (event) => openMeMenu(event.currentTarget));
  $('#btnMic').addEventListener('click', () => {
    state.prefs.micMuted = !state.prefs.micMuted;
    renderMe();
    persist();
    toast(state.prefs.micMuted ? 'Микрофон выключен' : 'Микрофон включён', 'ok');
  });
  $('#btnSound').addEventListener('click', () => {
    state.prefs.soundOff = !state.prefs.soundOff;
    renderMe();
    persist();
    toast(state.prefs.soundOff ? 'Звук уведомлений выключен' : 'Звук включён', 'ok');
  });

  $('#chatTitleBtn').addEventListener('click', () => {
    const conv = activeConv();
    if (!conv) return;
    if (conv.type === 'group') openGroupCard(conv.id);
    else openProfile(conv.peer);
  });
  $('#btnBack').addEventListener('click', () => $('#app').classList.remove('chat-open'));

  $('#chatIntro').addEventListener('click', (event) => {
    const groupBtn = event.target.closest('[data-open-group]');
    if (groupBtn) { openGroupCard(groupBtn.dataset.openGroup); return; }
    const profileBtn = event.target.closest('[data-open-profile]');
    if (profileBtn) { openProfile(profileBtn.dataset.openProfile); return; }
    const mediaBtn = event.target.closest('[data-open-media]');
    if (mediaBtn) { const conv = activeConv(); if (conv) openGalleryFor(conv); }
  });

  $('#messages').addEventListener('click', (event) => {
    const profileBtn = event.target.closest('[data-profile]');
    if (profileBtn) { openProfileCard(profileBtn.dataset.profile, profileBtn); return; }
    const mediaBtn = event.target.closest('[data-media-aid]');
    if (mediaBtn) { const conv = activeConv(); if (conv) openMediaFor(conv, mediaBtn.dataset.mediaAid); return; }
    const clear = event.target.closest('[data-clear-search]');
    if (clear) { closeSearchPanel(); return; }
    const create = event.target.closest('[data-create-group]');
    if (create) { openCreateGroup(); return; }
    const jump = event.target.closest('[data-jump]');
    if (jump) { scrollToMessage(jump.dataset.jump); return; }
    const react = event.target.closest('[data-react]');
    if (react) { toggleReaction(react.dataset.msg, react.dataset.react); return; }
    const reactAdd = event.target.closest('[data-react-add]');
    if (reactAdd) { openQuickReacts(reactAdd, reactAdd.dataset.reactAdd); return; }
    const reply = event.target.closest('[data-reply]');
    if (reply) { setReply(reply.dataset.reply); return; }
    const more = event.target.closest('[data-msg-more]');
    if (more) { openMessageMenu(more, more.dataset.msgMore); }
  });

  $('#membersPanel').addEventListener('click', (event) => {
    const close = event.target.closest('[data-close-members]');
    if (close) { toggleMembers(); return; }
    const profileBtn = event.target.closest('[data-profile]');
    if (profileBtn) { openProfileCard(profileBtn.dataset.profile, profileBtn); return; }
    const openProfileBtn = event.target.closest('[data-open-profile]');
    if (openProfileBtn) { openProfile(openProfileBtn.dataset.openProfile); return; }
    const mediaBtn = event.target.closest('[data-media-aid]');
    if (mediaBtn) { const conv = activeConv(); if (conv) openMediaFor(conv, mediaBtn.dataset.mediaAid); return; }
    const galleryBtn = event.target.closest('[data-open-media]');
    if (galleryBtn) { const conv = activeConv(); if (conv) openGalleryFor(conv); }
  });

  $('#btnMembers').addEventListener('click', () => {
    const conv = activeConv();
    if (conv && window.innerWidth <= 960) {
      if (conv.type === 'group') openGroupCard(conv.id, 'members');
      else openProfile(conv.peer);
      return;
    }
    toggleMembers();
  });
  $('#btnPins').addEventListener('click', () => openPins(activeConv()));
  $('#btnSearch').addEventListener('click', () => {
    if ($('#msgSearchWrap').hidden) openSearchPanel();
    else closeSearchPanel();
  });
  $('#msgSearchClose').addEventListener('click', closeSearchPanel);
  $('#msgSearch').addEventListener('input', (event) => {
    ui.msgQuery = event.target.value;
    const conv = activeConv();
    if (conv) renderMessages(conv);
    $('#chatScroll').scrollTop = 0;
  });
  $('#msgSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSearchPanel();
  });

  $('#composer').addEventListener('submit', (event) => {
    event.preventDefault();
    sendCurrent();
  });
  $('#composerInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendCurrent();
    }
  });
  $('#composerInput').addEventListener('input', resizeComposer);

  $('#btnAttach').addEventListener('click', () => $('#filePicker').click());
  $('#filePicker').addEventListener('change', (event) => {
    handleFiles(event.target.files);
    event.target.value = '';
  });
  $('#btnEmoji').addEventListener('click', openEmojiPicker);
  $('#emojiPop').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-emoji]');
    if (btn) insertEmoji(btn.dataset.emoji);
  });

  $('#replyChip').addEventListener('click', (event) => {
    if (event.target.closest('[data-reply-cancel]')) {
      ui.replyTo = null;
      renderReply();
    }
  });
  $('#pending').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-pend-rm]');
    if (!btn) return;
    ui.pending = ui.pending.filter((a) => a.aid !== btn.dataset.pendRm);
    renderPending();
  });

  $('#chatScroll').addEventListener('scroll', () => {
    closePopover();
    closeEmojiPicker();
  }, { passive: true });

  document.addEventListener('click', (event) => {
    const pop = $('#popover');
    if (!pop.hidden && popoverReady && !event.target.closest('#popover')) closePopover();
    const picker = $('#emojiPop');
    if (!picker.hidden && emojiReady && !event.target.closest('#emojiPop') && !event.target.closest('#btnEmoji')) closeEmojiPicker();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('#lightbox').hidden) { closeLightbox(); return; }
      if (!$('#emojiPop').hidden) { closeEmojiPicker(); return; }
      if (!$('#popover').hidden) { closePopover(); return; }
      if (modalStack.length) { closeModal(); return; }
      if ($('#app').classList.contains('chat-open') && window.innerWidth <= 960) {
        $('#app').classList.remove('chat-open');
      }
    }
    if (event.key === 'Tab' && $('#lightbox').hidden) focusTrap(event);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (modalStack.length || !$('#lightbox').hidden) return;
      const field = $('#convFilter');
      field.focus();
      field.select();
    }
    if (!$('#lightbox').hidden && lightboxState) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepLightbox(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); stepLightbox(1); }
    }
  });

  window.addEventListener('resize', () => {
    closePopover();
    closeEmojiPicker();
  });

  if (typeof bindSocial === 'function') bindSocial();
}

function initApp() {
  initMedia();
  bindEvents();
  renderAll();
  if (window.innerWidth <= 960) $('#app').classList.remove('chat-open');
  requestAnimationFrame(() => scrollBottom(false));
}

function bootAppOnce() {
  if (typeof NET !== 'undefined' && NET && typeof NET.start === 'function') {
    NET.start();
    return;
  }
  initApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootAppOnce);
} else {
  bootAppOnce();
}
