/*! KSS SDK - client for the Kamulanga Secondary School API. Browser + Node 18+. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KSS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class KSSError extends Error {
    constructor(status, message) { super(message); this.name = 'KSSError'; this.status = status; }
  }

  class Client {
    /** @param {{baseUrl:string, storage?:Storage, fetch?:Function}} opts */
    constructor(opts) {
      this.baseUrl = String(opts.baseUrl || '').replace(/\/$/, '');
      this._fetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
      this._store = opts.storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
      this._on = {}; this._pending = 0;
      this.token = this._store ? this._store.getItem('kss:token') : null;
      const c = this;

      this.auth = {
        adminLogin: (username, password) => c._login('/v1/auth/admin/login', { username, password }),
        pupilLogin: (passNumber, password) => c._login('/v1/auth/pupil/login', { passNumber, password }),
        signup: ({ name, cls, phone, password }) => c._req('POST', '/v1/auth/signup', { name, cls, phone, password }),
        changePassword: (current, next) => c._req('POST', '/v1/auth/password', { current, next }),
        me: () => c._req('GET', '/v1/me'),
        signOut: () => c._setToken(null),
        get signedIn() { return !!c.token; },
      };
      this.news = {
        list: (limit) => c._req('GET', '/v1/news' + q({ limit })),
        create: (n) => c._req('POST', '/v1/news', n),
        update: (id, n) => c._req('PATCH', '/v1/news/' + id, n),
        remove: (id) => c._req('DELETE', '/v1/news/' + id),
      };
      this.pupils = {
        list: (status) => c._req('GET', '/v1/pupils' + q({ status })),
        approve: (id) => c._req('POST', `/v1/pupils/${id}/approve`, {}),
        reject: (id) => c._req('POST', `/v1/pupils/${id}/reject`, {}),
        approveAll: () => c._req('POST', '/v1/pupils/approve-all', {}),
        resetPassword: (id) => c._req('POST', `/v1/pupils/${id}/reset-password`, {}),
        remove: (id) => c._req('DELETE', '/v1/pupils/' + id),
      };
      this.results = {
        list: (pupilId) => c._req('GET', '/v1/results' + q({ pupilId })),
        publish: (r) => c._req('POST', '/v1/results', r),     // {pupilId, term, year, assess, rows:[{subject,mark}], comment}
        remove: (id) => c._req('DELETE', '/v1/results/' + id),
      };
      this.timetable = {
        get: (cls) => c._req('GET', '/v1/timetable/' + encodeURIComponent(cls)),
        save: (cls, rows) => c._req('PUT', '/v1/timetable/' + encodeURIComponent(cls), { rows }),
      };
      this.notes = {
        list: (filter) => c._req('GET', '/v1/notes' + q(filter || {})),
        create: (n) => c._req('POST', '/v1/notes', n),
        update: (id, n) => c._req('PATCH', '/v1/notes/' + id, n),
        remove: (id) => c._req('DELETE', '/v1/notes/' + id),
      };
      this.meta = () => c._req('GET', '/v1/meta');
      this.health = () => c._req('GET', '/v1/health');
    }

    /** Events: 'busy' (true/false while any request is running), 'error' (KSSError), 'signout'. Returns an unsubscribe fn. */
    on(evt, fn) { (this._on[evt] = this._on[evt] || []).push(fn); return () => { this._on[evt] = this._on[evt].filter(f => f !== fn); }; }
    _emit(evt, arg) { (this._on[evt] || []).forEach(f => { try { f(arg); } catch (e) { /* listener errors never break requests */ } }); }

    _setToken(t) {
      this.token = t;
      if (this._store) { try { t ? this._store.setItem('kss:token', t) : this._store.removeItem('kss:token'); } catch (e) { /* storage blocked */ } }
      if (!t) this._emit('signout');
    }
    async _login(path, body) { const r = await this._req('POST', path, body); this._setToken(r.token); return r; }

    async _req(method, path, body) {
      if (!this._fetch) throw new KSSError(0, 'fetch is not available in this environment.');
      if (++this._pending === 1) this._emit('busy', true);
      try {
        const res = await this._fetch(this.baseUrl + path, {
          method,
          headers: Object.assign({ 'Content-Type': 'application/json' }, this.token ? { Authorization: 'Bearer ' + this.token } : {}),
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) {
          if (res.status === 401 && this.token) this._setToken(null);
          throw new KSSError(res.status, (data && data.error) || 'Request failed.');
        }
        return data;
      } catch (e) {
        const err = e instanceof KSSError ? e : new KSSError(0, 'Could not reach the school server. Check your connection.');
        this._emit('error', err);
        throw err;
      } finally {
        if (--this._pending === 0) this._emit('busy', false);
      }
    }
  }

  function q(o) {
    const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v));
    return p.length ? '?' + p.join('&') : '';
  }

  return { Client, KSSError, create: (opts) => new Client(opts) };
});
