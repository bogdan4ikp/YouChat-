'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function loadEnvFile(file) {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return;
  }
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'aurora-src');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'youchat.db');
const SESSION_COOKIE = 'youchat_sid';
const OAUTH_COOKIE = 'youchat_oauth';
const YANDEX_CLIENT_ID = String(process.env.YANDEX_CLIENT_ID || '').trim();
const YANDEX_CLIENT_SECRET = String(process.env.YANDEX_CLIENT_SECRET || '').trim();
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const YANDEX_ENABLED = Boolean(YANDEX_CLIENT_ID && YANDEX_CLIENT_SECRET);
const YANDEX_AUTHORIZE = 'https://oauth.yandex.ru/authorize';
const YANDEX_TOKEN = 'https://oauth.yandex.ru/token';
const YANDEX_INFO = 'https://login.yandex.ru/info?format=json';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_UPLOAD = 140 * 1024 * 1024;
const EDIT_WINDOW = 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  grad INTEGER NOT NULL DEFAULT 0,
  accent TEXT NOT NULL DEFAULT '#e6e2d8',
  custom TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  banner TEXT NOT NULL DEFAULT 'mono',
  banner_img TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  yandex_id TEXT,
  email TEXT NOT NULL DEFAULT '',
  birthday TEXT NOT NULL DEFAULT '',
  onboarded INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  peer_key TEXT,
  name TEXT NOT NULL DEFAULT '',
  handle TEXT,
  grad INTEGER NOT NULL DEFAULT 0,
  icon TEXT NOT NULL DEFAULT '',
  banner TEXT NOT NULL DEFAULT 'mono',
  banner_img TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  descr TEXT NOT NULL DEFAULT '',
  access TEXT NOT NULL DEFAULT 'closed',
  requests_on INTEGER NOT NULL DEFAULT 1,
  perms TEXT NOT NULL DEFAULT '{}',
  created INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_handle ON conversations(handle);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_peer ON conversations(peer_key);
CREATE TABLE IF NOT EXISTS members (
  conv_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined INTEGER NOT NULL,
  last_read INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conv_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  author TEXT NOT NULL,
  t INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  att TEXT NOT NULL DEFAULT '[]',
  react TEXT NOT NULL DEFAULT '{}',
  reply TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  edited_at INTEGER,
  sys TEXT,
  forwarded_from TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, t);
CREATE TABLE IF NOT EXISTS hides (
  msg_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (msg_id, user_id)
);
CREATE TABLE IF NOT EXISTS pins (
  conv_id TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  PRIMARY KEY (conv_id, msg_id)
);
CREATE TABLE IF NOT EXISTS join_requests (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_conv ON join_requests(conv_id);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id TEXT NOT NULL,
  by TEXT NOT NULL,
  t INTEGER NOT NULL,
  text TEXT NOT NULL
);
`);

function ensureColumn(table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('users', 'yandex_id', 'yandex_id TEXT');
ensureColumn('users', 'email', "email TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'birthday', "birthday TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'onboarded', 'onboarded INTEGER NOT NULL DEFAULT 1');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_yandex ON users(yandex_id) WHERE yandex_id IS NOT NULL');

const statements = new Map();const st = (sql) => {
  let found = statements.get(sql);
  if (!found) {
    found = db.prepare(sql);
    statements.set(sql, found);
  }
  return found;
};

const liveUsers = new Map();
const lastSeen = new Map();
const streams = new Map();

function now() {
  return Date.now();
}

function isoDate(ts) {
  return new Date(ts || now()).toISOString().slice(0, 10);
}

function newId(prefix) {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

function json(res, code, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store'
  });
  res.end(data);
}

function fail(res, code, message) {
  json(res, code, { error: message });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too-large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 4 * 1024 * 1024) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw Object.assign(new Error('bad-json'), { status: 400 });
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const at = part.indexOf('=');
    if (at < 0) return;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  });
  return out;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  st('INSERT INTO sessions (token, user_id, created, seen) VALUES (?,?,?,?)').run(token, userId, now(), now());
  return token;
}

function sessionCookie(token, req) {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https');
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL / 1000)}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = st('SELECT * FROM sessions WHERE token=?').get(token);
  if (!session) return null;
  if (now() - session.seen > SESSION_TTL) {
    st('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  if (now() - session.seen > 60 * 1000) {
    st('UPDATE sessions SET seen=? WHERE token=?').run(now(), token);
  }
  const user = st('SELECT * FROM users WHERE id=?').get(session.user_id);
  if (user) {
    lastSeen.set(user.id, now());
    if (now() - (user.last_seen || 0) > 60 * 1000) {
      st('UPDATE users SET last_seen=? WHERE id=?').run(now(), user.id);
    }
  }
  return user || null;
}

function presence(userId) {
  if ((liveUsers.get(userId) || 0) > 0) return 'online';
  const seen = lastSeen.get(userId) || 0;
  if (now() - seen < 5 * 60 * 1000) return 'idle';
  return 'offline';
}

function personOf(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    grad: row.grad || 0,
    accent: row.accent || '#e6e2d8',
    custom: row.custom || '',
    bio: row.bio || '',
    banner: row.banner || 'mono',
    bannerImg: row.banner_img || '',
    avatar: row.avatar || null,
    status: presence(row.id),
    joined: isoDate(row.created)
  };
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function getConv(id) {
  return st('SELECT * FROM conversations WHERE id=? AND deleted=0').get(id);
}

function getMember(convId, userId) {
  return st('SELECT * FROM members WHERE conv_id=? AND user_id=?').get(convId, userId);
}

function memberIds(convId) {
  return st('SELECT user_id FROM members WHERE conv_id=? AND hidden=0').all(convId).map((row) => row.user_id);
}

function rolesOf(convId) {
  const roles = {};
  st('SELECT user_id, role FROM members WHERE conv_id=? AND hidden=0').all(convId)
    .forEach((row) => { roles[row.user_id] = row.role; });
  return roles;
}

function permsOf(conv) {
  const parsed = parseJson(conv.perms, {});
  const admins = parsed.admins || {};
  return {
    admins: {
      deleteMessages: admins.deleteMessages !== false,
      removeMembers: admins.removeMembers !== false,
      acceptRequests: admins.acceptRequests !== false
    }
  };
}

function roleIn(convId, userId) {
  const member = getMember(convId, userId);
  return member ? member.role : null;
}

function isAdmin(conv, userId) {
  const role = roleIn(conv.id, userId);
  return role === 'owner' || role === 'admin';
}

function adminPerm(conv, userId, key) {
  const role = roleIn(conv.id, userId);
  if (role === 'owner') return true;
  if (role !== 'admin') return false;
  return permsOf(conv).admins[key] !== false;
}

function canManageMember(conv, actorId, targetId) {
  const actorRole = roleIn(conv.id, actorId);
  const targetRole = roleIn(conv.id, targetId);
  if (!actorRole || !targetRole) return false;
  if (actorId === targetId) return false;
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  return targetRole === 'member' && adminPerm(conv, actorId, 'removeMembers');
}

function audit(convId, byId, text) {
  st('INSERT INTO audit (conv_id, by, t, text) VALUES (?,?,?,?)').run(convId, byId, now(), String(text).slice(0, 300));
  st('DELETE FROM audit WHERE conv_id=? AND id NOT IN (SELECT id FROM audit WHERE conv_id=? ORDER BY id DESC LIMIT 60)').run(convId, convId);
}

function insertMessage(convId, msg) {
  const id = msg.id || newId('m');
  st(`INSERT INTO messages (id, conv_id, author, t, text, att, react, reply, pinned, deleted, edited_at, sys, forwarded_from)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    convId,
    msg.author,
    msg.t || now(),
    msg.text || '',
    JSON.stringify(msg.att || []),
    JSON.stringify(msg.react || {}),
    msg.reply || null,
    msg.pinned ? 1 : 0,
    msg.deleted ? 1 : 0,
    msg.editedAt || null,
    msg.sys || null,
    msg.forwardedFrom || null
  );
  return id;
}

function systemMessage(convId, authorId, text) {
  return insertMessage(convId, { author: authorId, text: '', sys: text, t: now() });
}

function pushConv(convId) {
  const ids = memberIds(convId);
  ids.forEach((userId) => pushUser(userId, { type: 'conv', convId }));
}

function pushUser(userId, payload) {
  const set = streams.get(userId);
  if (!set) return;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  set.forEach((res) => {
    if (res.writableEnded || res.destroyed) {
      set.delete(res);
      return;
    }
    try { res.write(line); } catch (error) { set.delete(res); }
  });
  if (!set.size) streams.delete(userId);
}

function messageOf(row) {
  return {
    id: row.id,
    author: row.author,
    t: row.t,
    text: row.text,
    att: parseJson(row.att, []),
    react: parseJson(row.react, {}),
    reply: row.reply || null,
    pinned: Boolean(row.pinned),
    deleted: Boolean(row.deleted),
    editedAt: row.edited_at || null,
    sys: row.sys || null,
    forwardedFrom: row.forwarded_from || null
  };
}

function buildState(userId) {
  const convRows = st(`SELECT c.*, m.role AS my_role, m.last_read AS my_last_read, m.pinned AS my_pinned
    FROM conversations c JOIN members m ON m.conv_id=c.id
    WHERE m.user_id=? AND m.hidden=0 AND c.deleted=0
    ORDER BY c.created ASC`).all(userId);

  const hiddenRows = st('SELECT msg_id FROM hides WHERE user_id=?').all(userId);
  const hiddenSet = new Set(hiddenRows.map((row) => row.msg_id));
  const peopleIds = new Set([userId]);
  const conversations = [];

  convRows.forEach((conv) => {
    const memberRows = st('SELECT * FROM members WHERE conv_id=? AND hidden=0').all(conv.id);
    memberRows.forEach((row) => peopleIds.add(row.user_id));
    const roles = {};
    memberRows.forEach((row) => { roles[row.user_id] = row.role; });

    const msgRows = st('SELECT * FROM messages WHERE conv_id=? ORDER BY t ASC').all(conv.id);
    const messages = [];
    let unread = 0;
    msgRows.forEach((row) => {
      if (hiddenSet.has(row.id)) return;
      peopleIds.add(row.author);
      messages.push(messageOf(row));
      if (row.author !== userId && !row.sys && row.t > (conv.my_last_read || 0)) unread += 1;
    });

    const pinnedMsgs = st('SELECT msg_id FROM pins WHERE conv_id=? ORDER BY t ASC').all(conv.id).map((row) => row.msg_id);
    const isAdminHere = conv.my_role === 'owner' || conv.my_role === 'admin';
    const requests = isAdminHere
      ? st('SELECT * FROM join_requests WHERE conv_id=? ORDER BY created ASC').all(conv.id)
        .map((row) => ({ id: row.id, personId: row.user_id, at: row.created }))
      : [];
    requests.forEach((row) => peopleIds.add(row.personId));

    const auditRows = isAdminHere
      ? st('SELECT * FROM audit WHERE conv_id=? ORDER BY t DESC LIMIT 50').all(conv.id)
        .map((row) => ({ t: row.t, by: row.by, text: row.text }))
      : [];
    auditRows.forEach((row) => peopleIds.add(row.by));

    let peer = null;
    if (conv.type === 'dm') {
      peer = memberRows.map((row) => row.user_id).find((id) => id !== userId) || userId;
    }

    conversations.push({
      id: conv.id,
      type: conv.type,
      peer,
      name: conv.name,
      handle: conv.handle || '',
      grad: conv.grad || 0,
      icon: conv.icon || '',
      banner: conv.banner || 'mono',
      bannerImg: conv.banner_img || '',
      avatar: conv.avatar || '',
      desc: conv.descr || '',
      access: conv.access === 'open' ? 'open' : 'closed',
      requestsOn: Boolean(conv.requests_on),
      perms: permsOf(conv),
      created: conv.created,
      members: memberRows.map((row) => row.user_id),
      roles,
      messages,
      pinnedMsgs,
      joinRequests: requests,
      audit: auditRows,
      unread,
      pinned: Boolean(conv.my_pinned)
    });
  });

  const ids = Array.from(peopleIds);
  const people = {};
  const chunk = 400;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const marks = slice.map(() => '?').join(',');
    st(`SELECT * FROM users WHERE id IN (${marks})`).all(...slice).forEach((row) => {
      people[row.id] = personOf(row);
    });
  }

  const meRow = st('SELECT onboarded, birthday, yandex_id, email FROM users WHERE id=?').get(userId) || {};
  const profile = {
    onboarded: meRow.onboarded !== 0,
    birthday: meRow.birthday || '',
    yandex: Boolean(meRow.yandex_id),
    email: meRow.email || ''
  };

  return { v: 3, me: userId, profile, people, conversations, serverNow: now() };
}

function publicUser(row, extra = {}) {
  const user = personOf(row);
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    grad: user.grad,
    accent: user.accent,
    custom: user.custom,
    bio: user.bio,
    banner: user.banner,
    bannerImg: user.bannerImg,
    avatar: user.avatar,
    status: user.status,
    joined: user.joined,
    ...extra
  };
}

function findDm(a, b) {
  const key = [a, b].sort().join(':');
  return st("SELECT * FROM conversations WHERE type='dm' AND peer_key=? AND deleted=0").get(key);
}

function ensureDm(a, b) {
  const existing = findDm(a, b);
  if (existing) {
    const member = getMember(existing.id, a);
    if (member && member.hidden) st('UPDATE members SET hidden=0 WHERE conv_id=? AND user_id=?').run(existing.id, a);
    return existing;
  }
  const id = newId('dm');
  const key = [a, b].sort().join(':');
  st('INSERT INTO conversations (id, type, peer_key, name, created) VALUES (?,?,?,?,?)').run(id, 'dm', key, '', now());
  st('INSERT INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(id, a, 'member', now());
  st('INSERT INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(id, b, 'member', now());
  return getConv(id);
}

function sanitizeAtt(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((item) => {
    const out = {
      aid: String(item.aid || newId('a')).slice(0, 40),
      k: ['img', 'vid', 'voice', 'note'].includes(item.k) ? item.k : 'img',
      src: typeof item.src === 'string' ? item.src.slice(0, 400000) : '',
      title: String(item.title || '').slice(0, 120)
    };
    if (Number.isFinite(Number(item.dur))) out.dur = Math.max(0, Math.min(3600, Math.round(Number(item.dur))));
    if (Number.isFinite(Number(item.w))) out.w = Math.max(1, Math.round(Number(item.w)));
    if (Number.isFinite(Number(item.h))) out.h = Math.max(1, Math.round(Number(item.h)));
    if (item.mirror) out.mirror = true;
    return out;
  });
}

function validHandle(handle) {
  return /^[a-z0-9-]{3,24}$/.test(handle);
}

function validUsername(name) {
  return /^[a-z0-9_]{3,24}$/.test(name);
}

function validBirthday(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function usernameTaken(username, selfId) {
  const row = st('SELECT id FROM users WHERE username=?').get(username);
  return Boolean(row && row.id !== selfId);
}

function handleTaken(handle, selfId) {
  const row = st('SELECT id FROM conversations WHERE handle=?').get(handle);
  return Boolean(row && row.id !== selfId);
}

const authAttempts = new Map();
function throttle(ip) {
  const entry = authAttempts.get(ip) || { count: 0, reset: now() + 10 * 60 * 1000 };
  if (now() > entry.reset) {
    entry.count = 0;
    entry.reset = now() + 10 * 60 * 1000;
  }
  entry.count += 1;
  authAttempts.set(ip, entry);
  return entry.count <= 40;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

async function serveFile(res, filePath, cache = 'no-cache') {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      fail(res, 404, 'not-found');
      return false;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': cache
    });
    if (res.req && res.req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      try { res.destroy(); } catch (error) { /* ignore */ }
    });
    res.on('close', () => {
      try { stream.destroy(); } catch (error) { /* ignore */ }
    });
    stream.pipe(res);
    return true;
  } catch (error) {
    return false;
  }
}

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function uniqueUsername(seed) {
  let slug = String(seed || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18);
  if (slug.length < 3) slug = ('user' + slug).slice(0, 18);
  let candidate = slug;
  let index = 1;
  while (st('SELECT id FROM users WHERE username=?').get(candidate)) {
    index += 1;
    candidate = `${slug.slice(0, 18)}_${index}`.slice(0, 24);
  }
  return candidate;
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u'
};

function latinSeed(text) {
  return String(text || '')
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 14);
}

function randomUsername(seed) {
  const base = latinSeed(seed) || 'youchat';
  const slug = (base.length >= 3 ? base : `${base}user`).slice(0, 14);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const digits = String(Math.floor(100 + Math.random() * 9900));
    const candidate = `${slug}_${digits}`.slice(0, 24);
    if (!st('SELECT id FROM users WHERE username=?').get(candidate)) return candidate;
  }
  return uniqueUsername(slug);
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

function yandexAvatar(info) {
  const avatarId = info && info.default_avatar_id;
  if (!avatarId || info.is_avatar_empty) return null;
  return `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200`;
}

function ensureYandexUser(info) {
  const yandexId = String(info.id);
  const email = String(info.default_email || '').slice(0, 190);
  const avatar = yandexAvatar(info);
  const existing = st('SELECT * FROM users WHERE yandex_id=?').get(yandexId);
  if (existing) {
    st('UPDATE users SET last_seen=?, email=?, avatar=COALESCE(?, avatar) WHERE id=?').run(now(), email, avatar, existing.id);
    return st('SELECT * FROM users WHERE id=?').get(existing.id);
  }
  const name = String(info.display_name || info.real_name
    || [info.first_name, info.last_name].filter(Boolean).join(' ')
    || info.login || 'Пользователь').trim().slice(0, 32) || 'Пользователь';
  const salt = crypto.randomBytes(16).toString('hex');
  const password = crypto.randomBytes(32).toString('hex');
  const id = newId('u');
  const username = randomUsername(name || info.login || email.split('@')[0]);
  const birthday = String(info.birthday || '').slice(0, 10);
  st(`INSERT INTO users (id, username, name, pass_hash, salt, grad, accent, custom, bio, banner, banner_img, avatar, yandex_id, email, birthday, onboarded, created, last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(
    id, username, name, hashPassword(password, salt), salt,
    Math.floor(Math.random() * 6), '#e6e2d8', '', '', 'mono', '', avatar,
    yandexId, email, birthday, now(), now()
  );
  return st('SELECT * FROM users WHERE id=?').get(id);
}

async function handleApi(req, res, url) {
  const user = currentUser(req);
  routes.length = 0;

  route('GET', /^\/api\/health$/, async () => {
    json(res, 200, { ok: true, name: 'YouChat server', time: now(), yandex: YANDEX_ENABLED });
  });

  // YouChat uses Yandex ID exclusively. Password registration/login are intentionally disabled.
  route('POST', /^\/api\/auth\/(?:register|login)$/, async () => {
    fail(res, 403, 'Вход и регистрация доступны только через Яндекс ID');
  });

  route('POST', /^\/api\/auth\/logout$/, async () => {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[SESSION_COOKIE]) st('DELETE FROM sessions WHERE token=?').run(cookies[SESSION_COOKIE]);
    res.setHeader('set-cookie', clearCookie());
    json(res, 200, { ok: true });
  });

  route('GET', /^\/api\/auth\/yandex\/start$/, async () => {
    if (!YANDEX_ENABLED) {
      res.writeHead(302, { location: '/?auth=yandex_unconfigured', 'cache-control': 'no-store' });
      res.end();
      return;
    }
    const state = crypto.randomBytes(18).toString('base64url');
    const target = new URL(YANDEX_AUTHORIZE);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('client_id', YANDEX_CLIENT_ID);
    target.searchParams.set('redirect_uri', `${baseUrl(req)}/api/auth/yandex/callback`);
    target.searchParams.set('state', state);
    target.searchParams.set('force_confirm', 'yes');
    res.writeHead(302, {
      'set-cookie': `${OAUTH_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      location: target.toString(),
      'cache-control': 'no-store'
    });
    res.end();
  });

  route('GET', /^\/api\/auth\/yandex\/callback$/, async () => {
    const clearOauth = `${OAUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    try {
      if (!YANDEX_ENABLED) throw new Error('disabled');
      const code = String(url.searchParams.get('code') || '');
      const state = String(url.searchParams.get('state') || '');
      const cookies = parseCookies(req.headers.cookie);
      if (!code) throw new Error('cancelled');
      if (!state || !cookies[OAUTH_COOKIE] || state !== cookies[OAUTH_COOKIE]) throw new Error('state');

      const tokenRes = await fetch(YANDEX_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: YANDEX_CLIENT_ID,
          client_secret: YANDEX_CLIENT_SECRET,
          redirect_uri: `${baseUrl(req)}/api/auth/yandex/callback`
        }).toString(),
        signal: AbortSignal.timeout(15000)
      });
      const tokenData = await tokenRes.json().catch(() => null);
      if (!tokenRes.ok || !tokenData || !tokenData.access_token) throw new Error('token');

      const infoRes = await fetch(YANDEX_INFO, {
        headers: { authorization: `OAuth ${tokenData.access_token}` },
        signal: AbortSignal.timeout(15000)
      });
      if (!infoRes.ok) throw new Error('profile');
      const info = await infoRes.json().catch(() => null);
      if (!info || !info.id) throw new Error('profile');

      const userRow = ensureYandexUser(info);
      const token = createSession(userRow.id);
      res.writeHead(302, {
        'set-cookie': [sessionCookie(token, req), clearOauth],
        location: userRow.onboarded === 0 ? '/?onboarding=1' : '/?auth=yandex_ok',
        'cache-control': 'no-store'
      });
      res.end();
    } catch (error) {
      const reason = error && error.message ? error.message : 'error';
      if (reason !== 'cancelled') console.error(new Date().toISOString(), 'yandex oauth:', reason);
      res.writeHead(302, {
        'set-cookie': clearOauth,
        location: `/?auth=yandex_error&reason=${encodeURIComponent(reason)}`,
        'cache-control': 'no-store'
      });
      res.end();
    }
  });

  route('GET', /^\/api\/state$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    json(res, 200, { state: buildState(user.id) });
  });

  route('GET', /^\/api\/me$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    json(res, 200, { person: publicUser(user) });
  });

  route('GET', /^\/api\/users$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().replace(/^@/, '');
    if (q.length < 2) return json(res, 200, { users: [] });
    const escaped = q.replace(/[\\%_]/g, (ch) => '\\' + ch);
    const like = `%${escaped}%`;
    const rows = st(`SELECT * FROM users WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN username = ? THEN 0 WHEN username LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, username
      LIMIT 24`).all(user.id, like, like, q, `${escaped}%`);
    const users = rows.map((row) => {
      const dm = findDm(user.id, row.id);
      return publicUser(row, { dmId: dm ? dm.id : null });
    });
    json(res, 200, { users });
  });

  route('GET', /^\/api\/username$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const candidate = String(url.searchParams.get('u') || '').trim().toLowerCase().replace(/^@/, '');
    if (!validUsername(candidate)) {
      return json(res, 200, { username: candidate, available: false, reason: 'format' });
    }
    const available = !usernameTaken(candidate, user.id);
    json(res, 200, { username: candidate, available, reason: available ? '' : 'taken' });
  });

  route('POST', /^\/api\/dm$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const body = await readJson(req);
    const peerId = String(body.peerId || '');
    const peer = st('SELECT * FROM users WHERE id=?').get(peerId);
    if (!peer) return fail(res, 404, 'Пользователь не найден');
    if (peerId === user.id) return fail(res, 400, 'Нельзя открыть переписку с собой');
    const conv = ensureDm(user.id, peerId);
    pushUser(peerId, { type: 'conv', convId: conv.id });
    json(res, 200, { convId: conv.id, state: buildState(user.id) });
  });

  route('POST', /^\/api\/conversations$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const handle = String(body.handle || '').trim().toLowerCase();
    const members = Array.isArray(body.members) ? body.members.map(String).filter((id) => id && id !== user.id) : [];
    if (name.length < 2 || name.length > 40) return fail(res, 400, 'Название от 2 до 40 символов');
    if (!validHandle(handle)) return fail(res, 400, 'Адрес группы: 3–24 символа, латиница, цифры и дефис');
    if (handleTaken(handle)) return fail(res, 409, 'Такой адрес уже занят');
    const validMembers = members.filter((id) => st('SELECT id FROM users WHERE id=?').get(id));
    const convId = newId('g');
    const perms = { admins: { deleteMessages: true, removeMembers: true, acceptRequests: true } };
    st(`INSERT INTO conversations (id, type, name, handle, grad, icon, banner, banner_img, avatar, descr, access, requests_on, perms, created)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      convId, 'group', name, handle, Number(body.grad) || 0,
      String(body.icon || name.slice(0, 2)).slice(0, 4),
      String(body.banner || 'mono'), String(body.bannerImg || '').slice(0, 400000),
      String(body.avatar || '').slice(0, 400000), String(body.desc || '').slice(0, 220),
      body.access === 'open' ? 'open' : 'closed',
      body.requestsOn === false ? 0 : 1,
      JSON.stringify(perms), now()
    );
    st('INSERT INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(convId, user.id, 'owner', now());
    validMembers.forEach((id) => {
      st('INSERT OR IGNORE INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(convId, id, 'member', now());
    });
    systemMessage(convId, user.id, `${user.name} создал(а) группу «${name}»`);
    pushConv(convId);
    json(res, 200, { convId, state: buildState(user.id) });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/messages$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    if (!getMember(conv.id, user.id)) return fail(res, 403, 'Вы не участник этой беседы');
    const body = await readJson(req);
    const text = String(body.text || '').slice(0, 4000);
    const att = sanitizeAtt(body.att);
    if (!text.trim() && !att.length) return fail(res, 400, 'Пустое сообщение');
    const reply = body.reply && st('SELECT id FROM messages WHERE id=? AND conv_id=?').get(String(body.reply), conv.id) ? String(body.reply) : null;
    const id = insertMessage(conv.id, {
      author: user.id,
      text,
      att,
      reply,
      forwardedFrom: body.forwardedFrom ? String(body.forwardedFrom).slice(0, 80) : null,
      t: now()
    });
    const row = st('SELECT * FROM messages WHERE id=?').get(id);
    pushConv(conv.id);
    json(res, 200, { message: messageOf(row) });
  });

  route('PATCH', /^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    const row = conv ? st('SELECT * FROM messages WHERE id=? AND conv_id=?').get(m[2], conv.id) : null;
    if (!conv || !row) return fail(res, 404, 'Сообщение не найдено');
    if (!getMember(conv.id, user.id)) return fail(res, 403, 'Нет доступа');
    if (row.author !== user.id) return fail(res, 403, 'Можно менять только свои сообщения');
    if (now() - row.t > EDIT_WINDOW) return fail(res, 400, 'Время редактирования истекло');
    const body = await readJson(req);
    const text = String(body.text || '').slice(0, 4000);
    if (!text.trim()) return fail(res, 400, 'Текст не может быть пустым');
    st('UPDATE messages SET text=?, edited_at=? WHERE id=?').run(text, now(), row.id);
    pushConv(conv.id);
    json(res, 200, { message: messageOf(st('SELECT * FROM messages WHERE id=?').get(row.id)) });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/messages\/delete$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    if (!getMember(conv.id, user.id)) return fail(res, 403, 'Нет доступа');
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
    const canAll = (row) => row.author === user.id || adminPerm(conv, user.id, 'deleteMessages');
    ids.forEach((id) => {
      const row = st('SELECT * FROM messages WHERE id=? AND conv_id=?').get(id, conv.id);
      if (!row) return;
      if (canAll(row)) {
        st('UPDATE messages SET deleted=1, text=\'\', att=\'[]\', react=\'{}\', edited_at=NULL WHERE id=?').run(id);
        st('DELETE FROM pins WHERE msg_id=?').run(id);
        st('DELETE FROM hides WHERE msg_id=?').run(id);
      } else {
        st('INSERT OR IGNORE INTO hides (msg_id, user_id) VALUES (?,?)').run(id, user.id);
      }
    });
    pushConv(conv.id);
    pushUser(user.id, { type: 'conv', convId: conv.id });
    json(res, 200, { ok: true });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/reaction$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    const row = conv ? st('SELECT * FROM messages WHERE id=? AND conv_id=?').get(m[2], conv.id) : null;
    if (!conv || !row) return fail(res, 404, 'Сообщение не найдено');
    if (!getMember(conv.id, user.id)) return fail(res, 403, 'Нет доступа');
    const body = await readJson(req);
    const emoji = String(body.emoji || '').slice(0, 12);
    if (!emoji) return fail(res, 400, 'Нет эмодзи');
    const react = parseJson(row.react, {});
    const list = Array.isArray(react[emoji]) ? react[emoji].slice() : [];
    const at = list.indexOf(user.id);
    if (at >= 0) list.splice(at, 1);
    else list.push(user.id);
    if (list.length) react[emoji] = list;
    else delete react[emoji];
    st('UPDATE messages SET react=? WHERE id=?').run(JSON.stringify(react), row.id);
    pushConv(conv.id);
    json(res, 200, { react });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/pin$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    const row = conv ? st('SELECT * FROM messages WHERE id=? AND conv_id=?').get(m[2], conv.id) : null;
    if (!conv || !row) return fail(res, 404, 'Сообщение не найдено');
    if (!getMember(conv.id, user.id)) return fail(res, 403, 'Нет доступа');
    const pinned = row.pinned ? 0 : 1;
    st('UPDATE messages SET pinned=? WHERE id=?').run(pinned, row.id);
    if (pinned) st('INSERT OR IGNORE INTO pins (conv_id, msg_id, t) VALUES (?,?,?)').run(conv.id, row.id, now());
    else st('DELETE FROM pins WHERE msg_id=?').run(row.id);
    pushConv(conv.id);
    json(res, 200, { pinned: Boolean(pinned) });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/read$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv || !getMember(conv.id, user.id)) return fail(res, 404, 'Беседа не найдена');
    st('UPDATE members SET last_read=? WHERE conv_id=? AND user_id=?').run(now(), conv.id, user.id);
    pushUser(user.id, { type: 'read', convId: conv.id });
    json(res, 200, { ok: true });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/pin$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv || !getMember(conv.id, user.id)) return fail(res, 404, 'Беседа не найдена');
    const body = await readJson(req);
    st('UPDATE members SET pinned=? WHERE conv_id=? AND user_id=?').run(body.pinned ? 1 : 0, conv.id, user.id);
    json(res, 200, { pinned: Boolean(body.pinned) });
  });

  route('DELETE', /^\/api\/conversations\/([^/]+)\/leave$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    const member = getMember(conv.id, user.id);
    if (!member) return fail(res, 404, 'Вы не участник');
    if (conv.type === 'group') {
      if (member.role === 'owner') {
        const others = st("SELECT user_id FROM members WHERE conv_id=? AND user_id!=? AND hidden=0").all(conv.id, user.id);
        if (others.length) return fail(res, 400, 'Сначала передайте владение другому участнику');
        st('UPDATE conversations SET deleted=1 WHERE id=?').run(conv.id);
      } else {
        systemMessage(conv.id, user.id, `${user.name} покинул(а) группу`);
        st('DELETE FROM members WHERE conv_id=? AND user_id=?').run(conv.id, user.id);
      }
      pushConv(conv.id);
    } else {
      st('UPDATE members SET hidden=1 WHERE conv_id=? AND user_id=?').run(conv.id, user.id);
      pushUser(user.id, { type: 'conv', convId: conv.id });
    }
    json(res, 200, { ok: true });
  });

  route('PATCH', /^\/api\/conversations\/([^/]+)$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    if (conv.type !== 'group') return fail(res, 400, 'Только для групп');
    if (roleIn(conv.id, user.id) !== 'owner') return fail(res, 403, 'Только владелец меняет настройки');
    const body = await readJson(req);
    const name = String(body.name ?? conv.name).trim().slice(0, 40);
    const handle = String(body.handle ?? conv.handle ?? '').trim().toLowerCase();
    if (name.length < 2) return fail(res, 400, 'Название от 2 символов');
    if (!validHandle(handle)) return fail(res, 400, 'Адрес: 3–24 символа, латиница, цифры и дефис');
    if (handleTaken(handle, conv.id)) return fail(res, 409, 'Такой адрес уже занят');
    const perms = body.perms ? permsOf({ perms: JSON.stringify(body.perms) }) : permsOf(conv);
    const access = body.access === undefined ? conv.access : (body.access === 'open' ? 'open' : 'closed');
    const requestsOn = body.requestsOn === undefined ? conv.requests_on : (body.requestsOn ? 1 : 0);
    st(`UPDATE conversations SET name=?, handle=?, descr=?, grad=?, banner=?, banner_img=?, avatar=?, access=?, requests_on=?, perms=?, icon=?
        WHERE id=?`).run(
      name, handle,
      String(body.desc ?? conv.descr).slice(0, 220),
      Number(body.grad ?? conv.grad) || 0,
      String(body.banner ?? conv.banner),
      String(body.bannerImg ?? conv.banner_img).slice(0, 400000),
      String(body.avatar ?? conv.avatar).slice(0, 400000),
      access,
      requestsOn,
      JSON.stringify(perms),
      String(body.icon || name.slice(0, 2)).slice(0, 4),
      conv.id
    );
    audit(conv.id, user.id, 'Настройки группы обновлены');
    pushConv(conv.id);
    json(res, 200, { state: buildState(user.id) });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/members$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    if (conv.type !== 'group') return fail(res, 400, 'Только для групп');
    if (!isAdmin(conv, user.id)) return fail(res, 403, 'Недостаточно прав');
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 50) : [];
    const added = [];
    ids.forEach((id) => {
      const row = st('SELECT * FROM users WHERE id=?').get(id);
      if (!row) return;
      const member = getMember(conv.id, id);
      if (member) {
        if (member.hidden) st('UPDATE members SET hidden=0 WHERE conv_id=? AND user_id=?').run(conv.id, id);
        return;
      }
      st('INSERT INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(conv.id, id, 'member', now());
      added.push(row.name);
      pushUser(id, { type: 'conv', convId: conv.id });
    });
    if (added.length) {
      systemMessage(conv.id, user.id, `${user.name} добавил(а) в группу: ${added.join(', ')}`);
      audit(conv.id, user.id, `Добавлены участники: ${added.join(', ')}`);
    }
    pushConv(conv.id);
    json(res, 200, { added: added.length, state: buildState(user.id) });
  });

  route('DELETE', /^\/api\/conversations\/([^/]+)\/members\/([^/]+)$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    if (!canManageMember(conv, user.id, m[2])) return fail(res, 403, 'Недостаточно прав');
    const target = st('SELECT * FROM users WHERE id=?').get(m[2]);
    st('DELETE FROM members WHERE conv_id=? AND user_id=?').run(conv.id, m[2]);
    st('DELETE FROM join_requests WHERE conv_id=? AND user_id=?').run(conv.id, m[2]);
    systemMessage(conv.id, user.id, `${target ? target.name : 'Участник'} исключён(а) из группы`);
    audit(conv.id, user.id, `Исключён(а): ${target ? target.name : m[2]}`);
    pushConv(conv.id);
    pushUser(m[2], { type: 'conv', convId: conv.id });
    json(res, 200, { state: buildState(user.id) });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/members\/([^/]+)\/role$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    if (roleIn(conv.id, user.id) !== 'owner') return fail(res, 403, 'Только владелец меняет роли');
    if (m[2] === user.id) return fail(res, 400, 'Нельзя менять свою роль');
    const body = await readJson(req);
    const role = body.role === 'admin' ? 'admin' : 'member';
    const target = getMember(conv.id, m[2]);
    if (!target) return fail(res, 404, 'Участник не найден');
    if (target.role === 'owner') return fail(res, 400, 'Нельзя изменить роль владельца');
    st('UPDATE members SET role=? WHERE conv_id=? AND user_id=?').run(role, conv.id, m[2]);
    const person = st('SELECT name FROM users WHERE id=?').get(m[2]);
    const label = person ? person.name : 'Участник';
    systemMessage(conv.id, user.id, role === 'admin' ? `${user.name} назначил(а) ${label} админом` : `${user.name} снял(а) ${label} с роли админа`);
    audit(conv.id, user.id, role === 'admin' ? `Назначен админом: ${label}` : `Снят с роли админа: ${label}`);
    pushConv(conv.id);
    json(res, 200, { state: buildState(user.id) });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/transfer$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Беседа не найдена');
    if (roleIn(conv.id, user.id) !== 'owner') return fail(res, 403, 'Только владелец передаёт владение');
    const body = await readJson(req);
    const targetId = String(body.userId || '');
    const target = getMember(conv.id, targetId);
    if (!target || targetId === user.id) return fail(res, 400, 'Передать можно только участнику группы');
    st("UPDATE members SET role='admin' WHERE conv_id=? AND role='owner'").run(conv.id);
    st("UPDATE members SET role='owner' WHERE conv_id=? AND user_id=?").run(conv.id, targetId);
    const person = st('SELECT name FROM users WHERE id=?').get(targetId);
    systemMessage(conv.id, user.id, `${person ? person.name : 'Участник'} теперь владелец группы`);
    audit(conv.id, user.id, `Владение передано: ${person ? person.name : targetId}`);
    pushConv(conv.id);
    json(res, 200, { state: buildState(user.id) });
  });

  route('GET', /^\/api\/groups\/by-handle$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const handle = String(url.searchParams.get('handle') || '').trim().toLowerCase();
    const conv = st("SELECT * FROM conversations WHERE type='group' AND handle=? AND deleted=0").get(handle);
    if (!conv) return fail(res, 404, 'Группа не найдена');
    const member = getMember(conv.id, user.id);
    const request = st('SELECT id FROM join_requests WHERE conv_id=? AND user_id=?').get(conv.id, user.id);
    const count = st('SELECT COUNT(*) AS n FROM members WHERE conv_id=? AND hidden=0').get(conv.id).n;
    json(res, 200, {
      group: {
        id: conv.id,
        name: conv.name,
        handle: conv.handle,
        desc: conv.descr,
        grad: conv.grad,
        avatar: conv.avatar,
        banner: conv.banner,
        bannerImg: conv.banner_img,
        access: conv.access,
        members: count,
        isMember: Boolean(member),
        requested: Boolean(request),
        requestsOn: Boolean(conv.requests_on)
      }
    });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/join$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv || conv.type !== 'group') return fail(res, 404, 'Группа не найдена');
    if (getMember(conv.id, user.id)) {
      const member = getMember(conv.id, user.id);
      if (member.hidden) st('UPDATE members SET hidden=0 WHERE conv_id=? AND user_id=?').run(conv.id, user.id);
      return json(res, 200, { status: 'member', convId: conv.id, state: buildState(user.id) });
    }
    if (conv.access === 'open' || !conv.requests_on) {
      st('INSERT INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(conv.id, user.id, 'member', now());
      systemMessage(conv.id, user.id, `${user.name} вступил(а) в группу`);
      pushConv(conv.id);
      return json(res, 200, { status: 'member', convId: conv.id, state: buildState(user.id) });
    }
    const existing = st('SELECT * FROM join_requests WHERE conv_id=? AND user_id=?').get(conv.id, user.id);
    if (!existing) {
      st('INSERT INTO join_requests (id, conv_id, user_id, created) VALUES (?,?,?,?)').run(newId('r'), conv.id, user.id, now());
      pushConv(conv.id);
    }
    json(res, 200, { status: 'requested', convId: conv.id });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/requests\/accept-all$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Группа не найдена');
    if (!adminPerm(conv, user.id, 'acceptRequests')) return fail(res, 403, 'Недостаточно прав');
    const rows = st('SELECT * FROM join_requests WHERE conv_id=?').all(conv.id);
    rows.forEach((row) => {
      st('DELETE FROM join_requests WHERE id=?').run(row.id);
      if (!getMember(conv.id, row.user_id)) {
        st('INSERT INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(conv.id, row.user_id, 'member', now());
      }
      pushUser(row.user_id, { type: 'conv', convId: conv.id });
    });
    if (rows.length) {
      systemMessage(conv.id, user.id, `Принято заявок: ${rows.length}`);
      audit(conv.id, user.id, `Принято заявок: ${rows.length}`);
      pushConv(conv.id);
    }
    json(res, 200, { accepted: rows.length, state: buildState(user.id) });
  });

  route('POST', /^\/api\/conversations\/([^/]+)\/requests\/([^/]+)$/, async (m) => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const conv = getConv(m[1]);
    if (!conv) return fail(res, 404, 'Группа не найдена');
    if (!adminPerm(conv, user.id, 'acceptRequests')) return fail(res, 403, 'Недостаточно прав');
    const body = await readJson(req);
    const reqRow = st('SELECT * FROM join_requests WHERE id=? AND conv_id=?').get(m[2], conv.id);
    if (!reqRow) return fail(res, 404, 'Заявка не найдена');
    st('DELETE FROM join_requests WHERE id=?').run(reqRow.id);
    const person = st('SELECT * FROM users WHERE id=?').get(reqRow.user_id);
    if (body.accept) {
      if (!getMember(conv.id, reqRow.user_id)) {
        st('INSERT INTO members (conv_id, user_id, role, joined) VALUES (?,?,?,?)').run(conv.id, reqRow.user_id, 'member', now());
      }
      systemMessage(conv.id, reqRow.user_id, `${person ? person.name : 'Участник'} вступил(а) в группу по заявке`);
      audit(conv.id, user.id, `Принята заявка: ${person ? person.name : reqRow.user_id}`);
      pushUser(reqRow.user_id, { type: 'conv', convId: conv.id });
    } else {
      audit(conv.id, user.id, `Отклонена заявка: ${person ? person.name : reqRow.user_id}`);
      pushUser(reqRow.user_id, { type: 'request-declined', convId: conv.id });
    }
    pushConv(conv.id);
    json(res, 200, { state: buildState(user.id) });
  });

  route('PATCH', /^\/api\/profile$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const body = await readJson(req);
    const name = String(body.name ?? user.name).trim().slice(0, 32);
    const username = String(body.username ?? user.username).trim().toLowerCase();
    const birthday = String(body.birthday ?? user.birthday ?? '').trim().slice(0, 10);
    if (name.length < 2) return fail(res, 400, 'Имя от 2 символов');
    if (!validUsername(username)) return fail(res, 400, 'Логин: 3–24 символа, латиница, цифры и _');
    if (usernameTaken(username, user.id)) return fail(res, 409, 'Этот адрес уже занят');
    if (!validBirthday(birthday)) return fail(res, 400, 'Дата рождения: формат ГГГГ-ММ-ДД');
    const onboarded = body.complete === true || user.onboarded !== 0 ? 1 : 0;
    st(`UPDATE users SET name=?, username=?, custom=?, bio=?, grad=?, banner=?, banner_img=?, avatar=?, birthday=?, onboarded=? WHERE id=?`).run(
      name,
      username,
      String(body.custom ?? user.custom).slice(0, 48),
      String(body.bio ?? user.bio).slice(0, 190),
      Number(body.grad ?? user.grad) || 0,
      String(body.banner ?? user.banner),
      String(body.bannerImg ?? user.banner_img).slice(0, 500000),
      body.avatar === null ? null : String(body.avatar ?? user.avatar ?? '').slice(0, 500000),
      birthday,
      onboarded,
      user.id
    );
    const fresh = st('SELECT * FROM users WHERE id=?').get(user.id);
    const convIds = st('SELECT conv_id FROM members WHERE user_id=?').all(user.id).map((row) => row.conv_id);
    convIds.forEach(pushConv);
    json(res, 200, { person: publicUser(fresh), state: buildState(user.id) });
  });

  route('POST', /^\/api\/upload$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const extFromName = path.extname(String(url.searchParams.get('name') || '')).toLowerCase();
    const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.webm', '.mp4', '.mov', '.m4a', '.ogg', '.mp3']);
    const byType = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
      'video/webm': '.webm', 'video/mp4': '.mp4', 'video/quicktime': '.mov',
      'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
      'audio/x-m4a': '.m4a'
    };
    const ext = byType[type] || (allowedExt.has(extFromName) ? extFromName : '');
    if (!ext || !/^(image|video|audio)\//.test(type)) return fail(res, 415, 'Неподдерживаемый тип файла');
    const raw = await readBody(req, MAX_UPLOAD);
    if (!raw.length) return fail(res, 400, 'Пустой файл');
    const fileName = `${newId('f')}${ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, fileName), raw);
    json(res, 200, { url: `/uploads/${fileName}`, size: raw.length, type });
  });

  route('GET', /^\/api\/stream$/, async () => {
    if (!user) return fail(res, 401, 'Требуется вход');
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    res.write(`retry: 3000\n\ndata: ${JSON.stringify({ type: 'hello', userId: user.id })}\n\n`);
    const set = streams.get(user.id) || new Set();
    set.add(res);
    streams.set(user.id, set);
    liveUsers.set(user.id, (liveUsers.get(user.id) || 0) + 1);
    lastSeen.set(user.id, now());
    const allConvs = st('SELECT conv_id FROM members WHERE user_id=?').all(user.id);
    allConvs.forEach((row) => pushConv(row.conv_id));
    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      try { res.write(': ping\n\n'); } catch (error) { /* closed */ }
    }, 25000);
    const cleanup = () => {
      clearInterval(heartbeat);
      const entries = streams.get(user.id);
      if (entries) {
        entries.delete(res);
        if (!entries.size) streams.delete(user.id);
      }
      const count = Math.max(0, (liveUsers.get(user.id) || 1) - 1);
      liveUsers.set(user.id, count);
      lastSeen.set(user.id, now());
      const convIds = st('SELECT conv_id FROM members WHERE user_id=?').all(user.id);
      convIds.forEach(pushConv);
    };
    res.on('error', cleanup);
    res.on('close', cleanup);
    req.on('close', cleanup);
    req.on('error', cleanup);
    return true;
  });

  for (const entry of routes) {
    if (entry.method !== req.method) continue;
    const match = url.pathname.match(entry.pattern);
    if (!match) continue;
    const keepOpen = await entry.handler(match);
    if (keepOpen === true) return true;
    return true;
  }
  fail(res, 404, 'Не найдено');
  return true;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (error) {
    fail(res, 400, 'Некорректный запрос');
    return;
  }

  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');

  if (url.pathname === '/health') {
    json(res, 200, { ok: true, service: 'youchat', database: 'connected' });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      const status = error.status || 500;
      if (status === 413) fail(res, 413, 'Файл слишком большой');
      else if (!res.headersSent) fail(res, status, status === 500 ? 'Внутренняя ошибка сервера' : error.message);
      else {
        try { res.end(); } catch (e) { /* ignore */ }
      }
      if (status === 500) console.error(new Date().toISOString(), req.method, url.pathname, error);
    }
    return;
  }

  if (url.pathname.startsWith('/uploads/')) {
    const fileName = path.basename(url.pathname);
    const served = await serveFile(res, path.join(UPLOAD_DIR, fileName), 'public, max-age=31536000, immutable');
    if (!served) fail(res, 404, 'Файл не найден');
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const clean = decodeURIComponent(url.pathname);
    const isSpa = clean === '/' || clean === '/index.html'
      || /^\/(g|u)\/[a-z0-9_-]{2,32}\/?$/i.test(clean)
      || /^\/m\/[a-z0-9_-]+\/[a-z0-9_-]+\/?$/i.test(clean);
    if (isSpa) {
      const ok = await serveFile(res, path.join(SRC_DIR, 'index.html'), 'no-cache');
      if (ok) return;
      fail(res, 404, 'Клиент не найден: ожидается папка aurora-src');
      return;
    }
    const target = path.normalize(path.join(SRC_DIR, clean)).replace(/^(\.\.[/\\])+/, '');
    if (!target.startsWith(SRC_DIR)) {
      fail(res, 403, 'Запрещено');
      return;
    }
    const ok = await serveFile(res, target, clean.match(/\.(png|jpg|svg|woff2)$/) ? 'public, max-age=86400' : 'no-cache');
    if (!ok) fail(res, 404, 'Не найдено');
    return;
  }

  fail(res, 405, 'Метод не поддерживается');
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`YouChat server: http://${shown}:${PORT}`);
  console.log(`Данные: ${DATA_DIR}`);
  console.log(YANDEX_ENABLED
    ? 'Вход через Яндекс ID: включён'
    : 'Вход через Яндекс ID: не настроен (YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET)');
});

process.on('uncaughtException', (error) => {
  console.error(new Date().toISOString(), 'uncaughtException', error && error.stack ? error.stack : error);
});

process.on('unhandledRejection', (error) => {
  console.error(new Date().toISOString(), 'unhandledRejection', error && error.stack ? error.stack : error);
});
