'use strict';

function avatarHTML(p, size = 40, opts = {}) {
  const grad = GRADS[(p.grad || 0) % GRADS.length];
  const inner = p.avatar ? `<img src="${p.avatar}" alt="">` : `<span>${esc(initials(p.name))}</span>`;
  const cls = p.avatar ? 'avatar has-img' : 'avatar';
  const av = `<span class="${cls}" style="--s:${size}px;--g1:${grad[0]};--g2:${grad[1]}">${inner}</span>`;
  if (!opts.status) return av;
  return `<span class="av-wrap" data-st="${p.status}" style="--st-border:${opts.border || 'var(--bg-1)'}">${av}<span class="av-status"></span></span>`;
}

function groupAvatarHTML(conv, size = 44, opts = {}) {
  const grad = GRADS[(conv.grad || 0) % GRADS.length];
  const radius = opts.round ? 'border-radius:50%;' : '';
  return `<span class="gicon" style="--s:${size}px;--g1:${grad[0]};--g2:${grad[1]};${radius}">${conv.avatar ? `<img src="${conv.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;position:relative">` : `<span>${esc(conv.icon || monogram(conv.name))}</span>`}</span>`;
}

function convAvatarHTML(conv, size = 40, opts = {}) {
  if (conv.type === 'group') {
    const wrap = `<span class="av-wrap">${groupAvatarHTML(conv, size, opts)}</span>`;
    return wrap;
  }
  return avatarHTML(person(conv.peer), size, opts);
}

function bannerHTML(id, cls = '', img = '') {
  if (img) {
    return `<div class="banner has-img ${cls}" aria-hidden="true" style="background-image:url('${String(img).replace(/'/g, '%27')}')"><b></b></div>`;
  }
  const safe = BANNERS.some((b) => b.id === id) ? id : 'mono';
  return `<div class="banner ${cls}" data-banner="${safe}" aria-hidden="true"><i></i><i></i><b></b></div>`;
}

function bannerOptionsHTML(selected, kind = 'all') {
  const list = kind === 'animated' ? BANNERS_ANIMATED : kind === 'static' ? BANNERS_STATIC : BANNERS;
  return list.map((b) => `
    <button type="button" class="bn-opt ${b.id === selected ? 'is-active' : ''}" data-banner-pick="${b.id}" aria-pressed="${b.id === selected}" aria-label="Баннер «${esc(b.name)}»">
      ${bannerHTML(b.id)}
      <span class="bn-kind">${isAnimatedBanner(b.id) ? 'анимация' : 'статика'}</span>
      <span class="bn-name">${esc(b.name)}</span>
      ${b.id === selected ? `<span class="bn-tick">${icon('check')}</span>` : ''}
    </button>`).join('');
}

function roleLabel(role) {
  if (role === 'owner') return 'Основатель';
  if (role === 'admin') return 'Админ';
  return 'Участник';
}

function roleIcon(role) {
  if (role === 'owner') return icon('crown');
  if (role === 'admin') return icon('shield');
  return '';
}

let toastId = 0;
function toast(text, kind = '') {
  const box = $('#toasts');
  if (!box) return;
  const node = document.createElement('div');
  node.className = 'toast ' + kind;
  node.dataset.toast = String(++toastId);
  node.innerHTML = `${icon(kind === 'warn' ? 'info' : 'sparkle')}<span>${esc(text)}</span>`;
  box.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => node.remove(), 220);
  }, 3000);
}

const modalStack = [];
let modalBound = false;

function bindModalShell() {
  if (modalBound) return;
  modalBound = true;
  $('#modalLayer').addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) closeModal();
  });
}

function openModal(html, opts = {}) {
  bindModalShell();
  const { size = 'md', onMount = null, label = 'Диалог' } = opts;
  const layer = $('#modalLayer');
  const node = document.createElement('div');
  node.className = 'modal-wrap';
  node.innerHTML = `
    <div class="modal-backdrop" data-modal-close></div>
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">
      <button class="icon-btn modal-close" data-modal-close aria-label="Закрыть">${icon('close')}</button>
      <div class="modal-scroll">${html}</div>
    </div>`;
  layer.append(node);
  layer.hidden = false;
  const entry = { node, onMount, returnFocus: document.activeElement };
  modalStack.push(entry);
  if (onMount) onMount($('.modal', node), node);
  requestAnimationFrame(() => {
    const coarse = window.matchMedia('(pointer:coarse)').matches;
    const target = coarse ? $('.modal', node) : $('.modal-scroll input:not([type="file"]), .modal-scroll textarea, .modal-scroll select, .modal-scroll .btn.primary, .modal', node);
    if (target) target.focus({ preventScroll: true });
  });
  return entry;
}

function refreshModal(html, onMount = null, size = null) {
  const entry = modalStack[modalStack.length - 1];
  if (!entry) return;
  const modal = $('.modal', entry.node);
  const scroll = $('.modal-scroll', modal);
  const keep = scroll.scrollTop;
  if (size) modal.className = 'modal ' + size;
  scroll.innerHTML = html;
  entry.onMount = onMount;
  if (onMount) onMount(modal, entry.node);
  scroll.scrollTop = keep;
  return entry;
}

function closeModal() {
  const entry = modalStack.pop();
  if (!entry) return;
  const node = entry.node;
  node.style.opacity = '0';
  node.style.transition = 'opacity .14s';
  setTimeout(() => node.remove(), 150);
  if (!modalStack.length) {
    setTimeout(() => {
      if (!modalStack.length) $('#modalLayer').hidden = true;
    }, 160);
  }
  if (entry.returnFocus && typeof entry.returnFocus.focus === 'function') {
    try { entry.returnFocus.focus({ preventScroll: true }); } catch (error) {}
  }
}

function closeAllModals() {
  while (modalStack.length) closeModal();
}

let popoverReady = false;
let popoverAnchor = null;

function openPopover(anchor, content, opts = {}) {
  const { kind = 'card', onMount = null, align = 'start' } = opts;
  const pop = $('#popover');
  const sheet = window.innerWidth <= 640;
  pop.className = 'popover' + (kind === 'menu' ? ' is-menu' : '') + (sheet ? ' as-sheet' : '');
  document.body.classList.toggle('sheet-open', sheet);
  pop.innerHTML = content;
  pop.hidden = false;
  pop.style.visibility = 'hidden';
  const rect = pop.getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  let left = align === 'center' ? r.left + r.width / 2 - rect.width / 2 : r.left;
  let top = r.bottom + 8;
  left = clamp(left, 8, Math.max(8, window.innerWidth - rect.width - 8));
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, r.top - rect.height - 8);
  }
  if (top < 8) top = 8;
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.style.visibility = '';
  popoverAnchor = anchor;
  popoverReady = false;
  requestAnimationFrame(() => { popoverReady = true; });
  if (onMount) onMount(pop);
}

function closePopover() {
  const pop = $('#popover');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = '';
  pop.className = 'popover';
  document.body.classList.remove('sheet-open');
  popoverAnchor = null;
  popoverReady = false;
}

function menuHTML(items) {
  return items.map((item) => {
    if (item === 'sep') return '<div class="menu-sep"></div>';
    if (item.title) return `<div class="menu-title">${esc(item.title)}</div>`;
    return `<button type="button" class="menu-item ${item.danger ? 'danger' : ''}" data-menu-act="${esc(item.id)}">${item.icon ? icon(item.icon) : ''}<span>${esc(item.label)}</span></button>`;
  }).join('');
}

function openMenu(anchor, items) {
  const id = uid('menu');
  openPopover(anchor, menuHTML(items), {
    kind: 'menu',
    onMount: (pop) => {
      pop.dataset.menuId = id;
      $$('[data-menu-act]', pop).forEach((btn) => {
        btn.addEventListener('click', () => {
          const found = items.find((it) => it && it.id === btn.dataset.menuAct);
          closePopover();
          if (found && found.onClick) found.onClick();
        });
      });
    }
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано в буфер обмена', 'ok');
    return true;
  } catch (error) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('Скопировано в буфер обмена', 'ok');
      return true;
    } catch (e) {
      toast('Не удалось скопировать', 'warn');
      return false;
    }
  }
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function focusTrap(event) {
  if (event.key !== 'Tab' || !modalStack.length) return;
  const top = modalStack[modalStack.length - 1].node;
  const nodes = $$('button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', top)
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
