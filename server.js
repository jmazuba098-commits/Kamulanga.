'use strict';
/* Kamulanga Secondary School API. Node 18+, no dependencies.
   Run:  ADMIN_PASSWORD='choose-a-strong-one' TOKEN_SECRET='long-random-string' node server.js */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 8787;
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ORIGIN = process.env.CORS_ORIGIN || '*';           // set to your site, e.g. https://kss.example.com
const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = 12 * 3600 * 1000;
const META = {
  school: 'Kamulanga Secondary School',
  grades: ['Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  tags: ['General', 'Exams', 'Events', 'Urgent'],
  terms: ['Term 1', 'Term 2', 'Term 3'],
};

/* ---------- storage ---------- */
let db;
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch { db = { counter: 0, admin: null, pupils: [], news: [], results: [], timetable: {}, notes: [] }; }
let saving = false, dirty = false;
function save() {
  dirty = true;
  if (saving) return;
  saving = true;
  setImmediate(() => {
    dirty = false;
    fs.writeFile(FILE + '.tmp', JSON.stringify(db), err => {
      if (!err) fs.rename(FILE + '.tmp', FILE, () => { saving = false; if (dirty) save(); });
      else { saving = false; console.error('save failed', err.message); }
    });
  });
}

/* ---------- crypto ---------- */
const rnd = n => crypto.randomBytes(n).toString('hex');
const hashPw = (pw, salt) => crypto.pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const b64 = s => Buffer.from(s).toString('base64url');
function sign(claims) {
  const body = b64(JSON.stringify({ ...claims, exp: Date.now() + TOKEN_TTL }));
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(tok) {
  const [body, mac] = String(tok || '').split('.');
  if (!body || !mac) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!same(mac, good)) return null;
  try { const c = JSON.parse(Buffer.from(body, 'base64url')); return c.exp > Date.now() ? c : null; } catch { return null; }
}
function tempPassword() {
  const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), b => al[b % al.length]).join('');
}

/* first run: create the admin from ADMIN_PASSWORD, or generate one and print it once */
if (!db.admin) {
  const pw = process.env.ADMIN_PASSWORD || tempPassword() + tempPassword();
  const salt = rnd(16);
  db.admin = { username: (process.env.ADMIN_USER || 'admin').toLowerCase(), salt, hash: hashPw(pw, salt) };
  if (!process.env.ADMIN_PASSWORD) console.log('First-run admin password (shown once):', pw);
  save();
}

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = m => new HttpError(400, m), clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const uid = () => Date.now().toString(36) + rnd(3);
const pub = p => { const { salt, hash, ...rest } = p; return rest; };
const attempts = new Map();
function throttle(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil((a.until - Date.now()) / 1000)} seconds.`);
}
function fail(key) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (++a.n >= 5) { a.until = Date.now() + 30000; a.n = 0; }
  attempts.set(key, a);
}
const pupilOf = id => db.pupils.find(p => p.id === id);
function needApproved(u) {
  const p = pupilOf(u.id);
  if (!p) throw new HttpError(401, 'Account not found.');
  if (p.status !== 'approved') throw new HttpError(403, 'Your student pass is not approved yet.');
  return p;
}

/* ---------- routes: [method, pattern, access, handler] ---------- */
const routes = [];
const R = (m, p, access, fn) => routes.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), access, fn]);

R('GET', '/v1/health', 'public', () => ({ ok: true, time: Date.now() }));
R('GET', '/v1/meta', 'public', () => META);

/* auth */
R('POST', '/v1/auth/admin/login', 'public', async ({ body, ip }) => {
  const key = 'a:' + ip; throttle(key);
  const u = clean(body.username).toLowerCase(), a = db.admin;
  if (!u || !body.password || u !== a.username || !same(hashPw(String(body.password), a.salt), a.hash)) { fail(key); throw new HttpError(401, 'Username or password is incorrect.'); }
  return { token: sign({ role: 'admin' }), role: 'admin' };
});
R('POST', '/v1/auth/pupil/login', 'public', ({ body, ip }) => {
  const id = clean(body.passNumber).toUpperCase(), key = 'p:' + ip + id; throttle(key);
  const p = pupilOf(id);
  if (!p || !body.password || !same(hashPw(String(body.password), p.salt), p.hash)) { fail(key); throw new HttpError(401, 'Pass number or password is incorrect.'); }
  return { token: sign({ role: 'pupil', id }), role: 'pupil', pupil: pub(p) };
});
R('POST', '/v1/auth/signup', 'public', ({ body }) => {
  const name = clean(body.name), cls = body.cls, phone = clean(body.phone), pw = String(body.password || '');
  if (name.length < 3 || !/[A-Za-z]/.test(name)) throw bad('Enter your full name.');
  if (!META.grades.includes(cls)) throw bad('Choose your grade.');
  if (phone && !/^[0-9+()\s-]{7,20}$/.test(phone)) throw bad('Enter a valid phone number, or leave it empty.');
  if (pw.length < 6) throw bad('Your password needs at least 6 characters.');
  const salt = rnd(16), id = `KSS-${new Date().getFullYear()}-${('000' + ++db.counter).slice(-4)}`;
  const p = { id, name, cls, phone, salt, hash: hashPw(pw, salt), status: 'pending', createdAt: Date.now() };
  db.pupils.push(p); save();
  return [201, pub(p)];
});
R('POST', '/v1/auth/password', 'user', ({ user, body }) => {
  const rec = user.role === 'admin' ? db.admin : pupilOf(user.id), min = user.role === 'admin' ? 8 : 6, nw = String(body.next || '');
  if (!rec || !same(hashPw(String(body.current || ''), rec.salt), rec.hash)) throw bad('Your current password is not correct.');
  if (nw.length < min) throw bad(`Your new password needs at least ${min} characters.`);
  if (nw === body.current) throw bad('Choose a password that is different from the current one.');
  rec.salt = rnd(16); rec.hash = hashPw(nw, rec.salt); delete rec.temp; save();
  return { ok: true };
});
R('GET', '/v1/me', 'user', ({ user }) => user.role === 'admin' ? { role: 'admin' } : { role: 'pupil', pupil: pub(pupilOf(user.id)) });

/* news (public read) */
const newsSorted = () => db.news.slice().sort((a, b) => b.createdAt - a.createdAt);
function newsFields(b) {
  const title = clean(b.title), body = String(b.body || '').trim(), tag = META.tags.includes(b.tag) ? b.tag : 'General';
  if (title.length < 3) throw bad('Enter a title of at least 3 characters.');
  if (body.length < 5) throw bad('Write the announcement message.');
  return { title, body, tag };
}
R('GET', '/v1/news', 'public', ({ query }) => newsSorted().slice(0, Math.min(+query.limit || 100, 200)));
R('POST', '/v1/news', 'admin', ({ body }) => { const n = { id: uid(), ...newsFields(body), createdAt: Date.now() }; db.news.push(n); save(); return [201, n]; });
R('PATCH', '/v1/news/:id', 'admin', ({ params, body }) => {
  const n = db.news.find(x => x.id === params.id); if (!n) throw new HttpError(404, 'Announcement not found.');
  Object.assign(n, newsFields({ ...n, ...body }), { updatedAt: Date.now() }); save(); return n;
});
R('DELETE', '/v1/news/:id', 'admin', ({ params }) => { db.news = db.news.filter(x => x.id !== params.id); save(); return { ok: true }; });

/* pupils (admin) */
R('GET', '/v1/pupils', 'admin', ({ query }) => db.pupils.filter(p => !query.status || p.status === query.status).map(pub));
R('POST', '/v1/pupils/approve-all', 'admin', () => {
  let n = 0; db.pupils.forEach(p => { if (p.status === 'pending') { p.status = 'approved'; p.approvedAt = Date.now(); n++; } });
  save(); return { approved: n };
});
function setStatus(status) {
  return ({ params }) => {
    const p = pupilOf(params.id); if (!p) throw new HttpError(404, 'Pupil not found.');
    p.status = status; if (status === 'approved') p.approvedAt = Date.now(); save(); return pub(p);
  };
}
R('POST', '/v1/pupils/:id/approve', 'admin', setStatus('approved'));
R('POST', '/v1/pupils/:id/reject', 'admin', setStatus('rejected'));
R('POST', '/v1/pupils/:id/reset-password', 'admin', ({ params }) => {
  const p = pupilOf(params.id); if (!p) throw new HttpError(404, 'Pupil not found.');
  const tmp = tempPassword(); p.salt = rnd(16); p.hash = hashPw(tmp, p.salt); p.temp = true; save();
  return { passNumber: p.id, temporaryPassword: tmp };
});
R('DELETE', '/v1/pupils/:id', 'admin', ({ params }) => {
  db.pupils = db.pupils.filter(p => p.id !== params.id); db.results = db.results.filter(r => r.pupilId !== params.id); save(); return { ok: true };
});

/* results */
R('GET', '/v1/results', 'user', ({ user, query }) => {
  if (user.role === 'pupil') { needApproved(user); return db.results.filter(r => r.pupilId === user.id); }
  return db.results.filter(r => !query.pupilId || r.pupilId === query.pupilId);
});
R('POST', '/v1/results', 'admin', ({ body }) => {
  const term = body.term, year = Number(body.year), assess = clean(body.assess), comment = String(body.comment || '').trim();
  if (!pupilOf(body.pupilId)) throw bad('Choose a pupil.');
  if (!META.terms.includes(term)) throw bad('Choose a term.');
  if (!(year >= 2000 && year <= 2100)) throw bad('Enter a valid year.');
  if (!assess) throw bad('Enter the assessment name, for example End of term.');
  const rows = (Array.isArray(body.rows) ? body.rows : []).map(r => ({ subject: clean(r.subject), mark: Number(r.mark) }));
  if (!rows.length || rows.some(r => !r.subject || isNaN(r.mark) || r.mark < 0 || r.mark > 100)) throw bad('Each subject needs a name and a mark from 0 to 100.');
  let rec = db.results.find(x => x.pupilId === body.pupilId && x.term === term && x.year === year && x.assess.toLowerCase() === assess.toLowerCase());
  if (rec) { Object.assign(rec, { rows, comment, updatedAt: Date.now() }); save(); return rec; }
  rec = { id: uid(), pupilId: body.pupilId, term, year, assess, rows, comment, createdAt: Date.now() };
  db.results.push(rec); save(); return [201, rec];
});
R('DELETE', '/v1/results/:id', 'admin', ({ params }) => { db.results = db.results.filter(r => r.id !== params.id); save(); return { ok: true }; });

/* timetable */
R('GET', '/v1/timetable/:cls', 'user', ({ user, params }) => {
  const cls = decodeURIComponent(params.cls);
  if (user.role === 'pupil' && needApproved(user).cls !== cls) throw new HttpError(403, 'You can only see your own class timetable.');
  return db.timetable[cls] || { rows: [], updatedAt: null };
});
R('PUT', '/v1/timetable/:cls', 'admin', ({ params, body }) => {
  const cls = decodeURIComponent(params.cls); if (!META.grades.includes(cls)) throw bad('Unknown grade.');
  const rows = (Array.isArray(body.rows) ? body.rows : []).map(r => ({ time: clean(r.time), cells: META.days.map((_, i) => clean((r.cells || [])[i])) }));
  if (rows.some(r => !r.time)) throw bad('Every row with lessons needs a time, for example 07:30–08:10.');
  return (db.timetable[cls] = { rows, updatedAt: Date.now() });
});

/* notes */
function noteFields(b) {
  const title = clean(b.title), subject = clean(b.subject), body = String(b.body || '').trim(), link = String(b.link || '').trim();
  const cls = b.cls === 'All' || META.grades.includes(b.cls) ? b.cls : 'All';
  if (title.length < 3) throw bad('Enter a title of at least 3 characters.');
  if (body.length < 3) throw bad('Write the note.');
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw bad('The link must start with http:// or https://');
  return { title, subject, cls, body, link };
}
R('GET', '/v1/notes', 'user', ({ user, query }) => {
  const mine = user.role === 'pupil' ? needApproved(user).cls : query.cls;
  return db.notes.filter(n => (!mine || n.cls === 'All' || n.cls === mine) && (!query.subject || n.subject === query.subject)).sort((a, b) => b.createdAt - a.createdAt);
});
R('POST', '/v1/notes', 'admin', ({ body }) => { const n = { id: uid(), ...noteFields(body), createdAt: Date.now() }; db.notes.push(n); save(); return [201, n]; });
R('PATCH', '/v1/notes/:id', 'admin', ({ params, body }) => {
  const n = db.notes.find(x => x.id === params.id); if (!n) throw new HttpError(404, 'Note not found.');
  Object.assign(n, noteFields({ ...n, ...body }), { updatedAt: Date.now() }); save(); return n;
});
R('DELETE', '/v1/notes/:id', 'admin', ({ params }) => { db.notes = db.notes.filter(n => n.id !== params.id); save(); return { ok: true }; });

/* ---------- server ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(bad('Body must be valid JSON.')); } });
  });
}
const server = http.createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'X-Content-Type-Options': 'nosniff',
    });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  if (req.method === 'OPTIONS') return send(204);
  try {
    const url = new URL(req.url, 'http://x'), query = Object.fromEntries(url.searchParams);
    for (const [m, re, access, fn] of routes) {
      const match = m === req.method && re.exec(url.pathname);
      if (!match) continue;
      let user = null;
      if (access !== 'public') {
        user = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!user) throw new HttpError(401, 'Sign in to continue.');
        if (access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Only the admin can do this.');
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const out = await fn({ params: match.groups || {}, query, body, user, ip: req.socket.remoteAddress });
      return Array.isArray(out) && typeof out[0] === 'number' ? send(out[0], out[1]) : send(200, out);
    }
    throw new HttpError(404, 'Not found.');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong.' });
  }
});
if (require.main === module) server.listen(PORT, () => console.log(`KSS API on http://localhost:${PORT}`));
module.exports = server;
