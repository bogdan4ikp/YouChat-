'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (prefix = 'id') => prefix + Math.random().toString(36).slice(2, 9);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const GRADS = [
  ['#e8e2d4', '#cdc0a6'],
  ['#e0e7e0', '#bdcbbf'],
  ['#e0e5eb', '#bec8d4'],
  ['#eae0da', '#d2bab0'],
  ['#e5e1eb', '#c8c1d4'],
  ['#e7e6e4', '#c7c6c2']
];

const BANNERS_ANIMATED = [
  { id: 'aurora', name: 'Дымка' },
  { id: 'nebula', name: 'Туман' },
  { id: 'waves', name: 'Штрихи' },
  { id: 'starlight', name: 'Пыль' },
  { id: 'pulse', name: 'Волна' },
  { id: 'prism', name: 'Блик' }
];
const BANNERS_STATIC = [
  { id: 'dusk', name: 'Песок' },
  { id: 'ocean', name: 'Графит' },
  { id: 'forest', name: 'Мох' },
  { id: 'ember', name: 'Глина' },
  { id: 'mono', name: 'Бумага' },
  { id: 'bloom', name: 'Иней' }
];
const BANNERS = [...BANNERS_ANIMATED, ...BANNERS_STATIC];
const bannerName = (id) => (BANNERS.find((b) => b.id === id) || BANNERS[0]).name;
const isAnimatedBanner = (id) => BANNERS_ANIMATED.some((b) => b.id === id);

const EMOJIS = ['😀','😄','😊','🙂','😉','😍','🤩','😎','🥳','😢','😭','😤','🤔','😴','🙃','😅','🤯','😇','🙌','👏','👍','👎','✌️','🤝','💜','❤️','🔥','✨','🎉','🎧','🎬','🌙','⭐','☕','🍕','🎨','🖼️','📸','🚀','🌊','🌿','🏔️','🪐','💫','🕹️','💻','📌','✅'];
const QUICK_REACTS = ['❤️', '🔥', '😂', '👍', '😮', '🎉'];

const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};
const monogram = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};
const pluralMembers = (n) => {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'участник';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'участника';
  return 'участников';
};
const membersLabel = (n) => `${n} ${pluralMembers(n)}`;

const hashStr = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ART_PALETTES = [
  { bg: ['#191917', '#0b0b0a'], blobs: ['#4b4a45', '#6a6154', '#3b3b3d', '#847a6b'] },
  { bg: ['#1d1a17', '#0c0b09'], blobs: ['#5a4f43', '#77685a', '#403a33', '#93846f'] },
  { bg: ['#14181a', '#080909'], blobs: ['#354447', '#4e5f63', '#2a3236', '#758a8b'] },
  { bg: ['#1b1614', '#0b0908'], blobs: ['#57403a', '#6b4c40', '#382a26', '#84695a'] },
  { bg: ['#121316', '#070808'], blobs: ['#383e46', '#565f69', '#282c32', '#879098'] },
  { bg: ['#171717', '#080808'], blobs: ['#474747', '#6b6b6b', '#373737', '#989898'] }
];

const artCache = new Map();
function artSrc(seed, width = 1200, height = 900) {
  const key = `${seed}|${width}x${height}`;
  if (artCache.has(key)) return artCache.get(key);
  const rand = mulberry32(hashStr(String(seed)));
  const range = (a, b) => a + (b - a) * rand();
  const palette = ART_PALETTES[Math.floor(rand() * ART_PALETTES.length)];
  let blobs = '';
  for (let i = 0; i < 5; i++) {
    const cx = range(-0.05, 1.05) * width;
    const cy = range(-0.05, 1.05) * height;
    const rx = range(0.18, 0.44) * width;
    const ry = range(0.2, 0.5) * height;
    const color = palette.blobs[i % palette.blobs.length];
    blobs += `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${color}" opacity="${range(0.4, 0.8).toFixed(2)}"/>`;
  }
  const rx = range(0.12, 0.26) * Math.min(width, height);
  const cx = range(0.2, 0.8) * width;
  const cy = range(0.2, 0.8) * height;
  const tilt = range(-30, 30).toFixed(1);
  const beamY = range(0.15, 0.7) * height;
  const beamH = range(0.05, 0.16) * height;
  const dots = Array.from({ length: 26 }, () => {
    const x = (range(0, 1) * width).toFixed(0);
    const y = (range(0, 1) * height).toFixed(0);
    return `<circle cx="${x}" cy="${y}" r="${range(0.7, 2.4).toFixed(1)}" fill="#fff" opacity="${range(0.15, 0.7).toFixed(2)}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.bg[0]}"/><stop offset="1" stop-color="${palette.bg[1]}"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<filter id="blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${(width * 0.06).toFixed(0)}"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
</defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>
<g filter="url(#blur)">${blobs}</g>
<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rx.toFixed(0)}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="${Math.max(1, width * 0.0016).toFixed(1)}"/>
<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(rx * 0.72).toFixed(0)}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="${Math.max(1, width * 0.0012).toFixed(1)}"/>
<g transform="rotate(${tilt} ${(width / 2).toFixed(0)} ${(height / 2).toFixed(0)})"><rect x="${(-width * 0.2).toFixed(0)}" y="${beamY.toFixed(0)}" width="${(width * 1.4).toFixed(0)}" height="${beamH.toFixed(0)}" fill="url(#beam)" opacity=".5"/></g>
${dots}
<rect width="${width}" height="${height}" filter="url(#grain)" opacity=".14" style="mix-blend-mode:overlay"/>
<rect width="${width}" height="${height}" fill="url(#vig)"/>
</svg>`;
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  if (artCache.size > 140) artCache.clear();
  artCache.set(key, src);
  return src;
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDayLong = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonthShort = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const fmtDay = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start - day) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};
const fmtShort = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return fmtTime(ts);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (same(d, y)) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};
const fmtDur = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtJoined = (ts) => new Date(ts).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

const orderedPairs = (obj) => Object.entries(obj).sort((a, b) => a[1] - b[1]);
const ago = (days, hours = 0, minutes = 0) => Date.now() - ((days * 24 + hours) * 60 + minutes) * 60000;

function demoState() {
  const people = {
    me: {
      id: 'me', name: 'Мой профиль', username: 'user', grad: 0, accent: '#e6e2d8', status: 'online',
      custom: '', bio: '', banner: 'mono', joined: new Date().toISOString().slice(0, 10), avatar: null
    }
  };

  const conversations = [];

  return {
    v: 3,
    me: 'me',
    people,
    conversations,
    activeId: null,
    prefs: { membersOpen: window.innerWidth > 1180 }
  };
}

const STORE_KEY = 'aurora.messenger.v3';
let memoryStore = null;

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch (error) {
    raw = memoryStore;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 3 || !parsed.people || !Array.isArray(parsed.conversations)) return null;
    if (!parsed.conversations.some((c) => c.id === parsed.activeId)) parsed.activeId = parsed.conversations[0]?.id || null;
    parsed.prefs = parsed.prefs || { membersOpen: true };
    const used = new Set([parsed.me]);
    parsed.conversations.forEach((c) => {
      if (c.peer) used.add(c.peer);
      (c.members || []).forEach((id) => used.add(id));
      (c.messages || []).forEach((m) => used.add(m.author));
    });
    Object.keys(parsed.people).forEach((id) => {
      const p = parsed.people[id];
      if (!used.has(id) || (id !== parsed.me && ['liza', 'artem', 'mark', 'sonya', 'kirill'].includes(id))) delete parsed.people[id];
    });
    parsed.conversations = parsed.conversations.filter((c) => c.type !== 'dm' || parsed.people[c.peer]);
    parsed.conversations.forEach((c) => {
      c.messages = c.messages || [];
      c.pinnedMsgs = c.pinnedMsgs || [];
      c.hiddenFor = c.hiddenFor || [];
      if (c.type === 'group') {
        c.members = Array.from(new Set((c.members || []).filter((id) => parsed.people[id])));
        c.roles = c.roles || {};
        Object.keys(c.roles).forEach((id) => { if (!c.members.includes(id) || !['owner', 'admin', 'member'].includes(c.roles[id])) delete c.roles[id]; });
        const owners = c.members.filter((id) => c.roles[id] === 'owner');
        const ownerId = owners.includes(parsed.me) ? parsed.me : (owners[0] || (c.members.includes(parsed.me) ? parsed.me : c.members[0]));
        c.members.forEach((id) => { c.roles[id] = id === ownerId ? 'owner' : (c.roles[id] === 'admin' ? 'admin' : 'member'); });
        c.access = c.access === 'open' ? 'open' : 'closed';
        c.requestsOn = c.requestsOn !== false;
        c.joinRequests = (c.joinRequests || []).filter((r) => r && r.personId && parsed.people[r.personId] && !c.members.includes(r.personId));
        c.perms = c.perms && c.perms.admins ? c.perms : { admins: { deleteMessages: true, removeMembers: true, acceptRequests: true } };
        ['deleteMessages', 'removeMembers', 'acceptRequests'].forEach((key) => { c.perms.admins[key] = c.perms.admins[key] !== false; });
      }
      c.messages.forEach((m) => {
        m.att = m.att || [];
        m.react = m.react || {};
        m.hiddenFor = m.hiddenFor || [];
        m.att.forEach((a) => { if (!a.aid) a.aid = uid('a'); });
      });
    });
    return parsed;
  } catch (error) {
    return null;
  }
}

let state = loadState() || demoState();
let storageOK = true;
let saveTimer = null;

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPersist, 220);
}

function flushPersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (typeof NET !== 'undefined' && NET.online) return;
  {
    try {
      const clone = JSON.parse(JSON.stringify(state, (key, value) => {
        if (key === 'src' && typeof value === 'string' && value.startsWith('blob:')) return null;
        return value;
      }));
      localStorage.setItem(STORE_KEY, JSON.stringify(clone));
      memoryStore = JSON.stringify(clone);
      storageOK = true;
    } catch (error) {
      if (storageOK) {
        storageOK = false;
        if (typeof toast === 'function') toast('Локальное хранилище заполнено — изменения останутся до перезагрузки', 'warn');
      }
    }
  }
}

const me = () => state.people[state.me];
const person = (id) => state.people[id] || { id, name: 'Неизвестный', username: 'unknown', grad: 0, accent: '#e6e2d8', status: 'offline', bio: '', banner: 'mono', custom: '' };
const findConv = (id) => state.conversations.find((c) => c.id === id);
const activeConv = () => findConv(state.activeId) || state.conversations[0];
const convTitle = (conv) => conv.type === 'group' ? conv.name : person(conv.peer).name;
const convSub = (conv) => conv.type === 'group' ? `${conv.members.length} участников` : person(conv.peer).name;
const convGrad = (conv) => conv.type === 'group' ? conv.grad : person(conv.peer).grad;
const convBanner = (conv) => conv.type === 'group' ? conv.banner : person(conv.peer).banner;

function statusText(p) {
  if (p.status === 'online') return 'в сети';
  if (p.status === 'idle') return 'неактивен';
  if (p.status === 'dnd') return 'не беспокоить';
  return 'не в сети';
}

function lastMessage(conv) {
  const list = conv.messages;
  for (let i = list.length - 1; i >= 0; i--) {
    if (!list[i].sys) return list[i];
  }
  return list[list.length - 1] || null;
}

function previewOf(conv) {
  const msg = lastMessage(conv);
  if (!msg) return 'Начните переписку';
  if (msg.deleted) return 'Сообщение удалено';
  let text = msg.text || '';
  if (!text && msg.att && msg.att.length) {
    const video = msg.att.find((a) => a.k === 'vid');
    text = video ? 'Видео' : msg.att.length > 1 ? `Фото · ${msg.att.length}` : 'Фото';
  }
  if (msg.sys) return msg.sys;
  return conv.type === 'group' ? `${person(msg.author).name.split(' ')[0]}: ${text}` : text;
}

function collectMedia(conv) {
  const out = [];
  if (!conv) return out;
  conv.messages.forEach((m) => {
    (m.att || []).forEach((a) => out.push({ a, m, conv }));
  });
  return out;
}

function mediaForPerson(personId) {
  const out = [];
  state.conversations.forEach((conv) => {
    conv.messages.forEach((m) => {
      if (m.author !== personId) return;
      (m.att || []).forEach((a) => out.push({ a, m, conv }));
    });
  });
  return out;
}

const HOST = 'youchat-msg.ru';
const groupLink = (conv) => `https://${HOST}/g/${conv.handle || conv.id}`;
const profileLink = (p) => `https://${HOST}/u/${p.username || p.id}`;
const messageLink = (conv, m) => `https://${HOST}/m/${conv.id}/${m.id}`;

const EDIT_WINDOW = 24 * 60 * 60 * 1000;
const REC_LIMIT = 60;
const NAME_LIMIT = { person: { min: 3, max: 24 }, group: { min: 3, max: 24 } };
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};
function latinize(value) {
  return String(value || '').toLowerCase().replace(/[а-яё]/g, (ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ''));
}
function cleanHandle(value, dash = true) {
  const allowed = dash ? /[^a-z0-9-]/g : /[^a-z0-9_]/g;
  return latinize(value).replace(/\s+/g, '-').replace(allowed, '').slice(0, 24);
}
function handleTaken(kind, value, selfId = null) {
  if (!value) return false;
  if (kind === 'group') return state.conversations.some((c) => c.type === 'group' && c.handle === value && c.id !== selfId);
  return Object.values(state.people).some((p) => p.id !== (selfId || state.me) && p.username === value);
}
const myRole = (conv) => (conv && conv.type === 'group' ? (conv.roles?.[state.me] || 'member') : null);
const isOwner = (conv) => myRole(conv) === 'owner';
const isGroupAdmin = (conv) => ['owner', 'admin'].includes(myRole(conv));
const adminPerm = (conv, key) => {
  if (!conv || conv.type !== 'group') return false;
  if (myRole(conv) === 'owner') return true;
  if (myRole(conv) !== 'admin') return false;
  return conv.perms?.admins?.[key] !== false;
};
const canManageMember = (conv, id) => {
  if (!conv || conv.type !== 'group' || id === state.me) return false;
  const target = conv.roles?.[id] || 'member';
  if (target === 'owner') return false;
  if (isOwner(conv)) return true;
  return target === 'member' && adminPerm(conv, 'removeMembers');
};
function logAdmin(conv, text) {
  conv.audit = conv.audit || [];
  conv.audit.unshift({ t: Date.now(), by: state.me, text });
  if (conv.audit.length > 50) conv.audit.length = 50;
}
const canDeleteForAll = (conv, m) => m.author === state.me || adminPerm(conv, 'deleteMessages');
const canEditMessage = (m) => m.author === state.me && !m.deleted && Date.now() - m.t < EDIT_WINDOW;
const accessLabel = (conv) => (conv.access === 'open' ? 'Открытая' : 'Закрытая');
const accessHint = (conv) => (conv.access === 'open' ? 'Вступить можно по ссылке без заявки' : 'Вступление по ссылке и заявке');

function unreadTotal() {

  return state.conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
}

function contacts() {
  const ids = new Set(state.conversations
    .filter((c) => c.type === 'dm' && c.messages.some((m) => !m.sys && !m.deleted))
    .map((c) => c.peer));
  return Object.values(state.people).filter((p) => p.id !== state.me && ids.has(p.id));
}

function groupsOf(personId) {
  return state.conversations.filter((c) => c.type === 'group' && c.members.includes(personId));
}

function dmWith(personId) {
  return state.conversations.find((c) => c.type === 'dm' && c.peer === personId);
}

function titleBadge() {
  const n = unreadTotal();
  document.title = n ? `YouChat (${n})` : 'YouChat — мессенджер';
}
