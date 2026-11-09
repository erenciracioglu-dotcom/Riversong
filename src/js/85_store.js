/* Riversong — saving: every song is a place, kept in the browser; share links carry a whole valley. */
'use strict';
RS.store = (() => {
  const IDX = 'riversong.atlas', VK = 'riversong.v.', CUR = 'riversong.current';
  let mem = {}; // fallback if storage is blocked
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] != null ? mem[k] : null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { if (e && /quota/i.test(e.name + e.message)) return false; mem[k] = v; return true; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } },
  };
  function index() { try { return JSON.parse(ls.get(IDX) || '[]'); } catch (e) { return []; } }
  function writeIndex(a) { return ls.set(IDX, JSON.stringify(a)); }
  function save(valley, lanterns, thumb) {
    const data = RS.model.serialize(valley);
    if (lanterns) data.lanterns = lanterns.map((o) => [valley.streams.findIndex((s) => s.id === o.sid), Math.round(o.u * 1000) / 1000, o.held ? 1 : 0]).filter((x) => x[0] >= 0);
    const ok = ls.set(VK + valley.id, JSON.stringify(data));
    const idx = index();
    let e = idx.find((x) => x.id === valley.id);
    if (!e) { e = { id: valley.id }; idx.unshift(e); }
    e.name = valley.name; e.updated = valley.updated; e.created = valley.created;
    if (thumb) e.thumb = thumb;
    if (!writeIndex(idx) && thumb) { delete e.thumb; writeIndex(idx); }
    return ok;
  }
  function raw(id) { const s = ls.get(VK + id); try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function load(id) { const o = raw(id); return o ? RS.model.deserialize(o) : null; }
  function rename(id, name) {
    const o = raw(id);
    if (o) { o.name = name; ls.set(VK + id, JSON.stringify(o)); }
    const idx = index(); const e = idx.find((x) => x.id === id); if (e) { e.name = name; writeIndex(idx); }
  }
  function remove(id) { ls.del(VK + id); writeIndex(index().filter((x) => x.id !== id)); }
  const current = () => ls.get(CUR);
  const setCurrent = (id) => ls.set(CUR, id);

  // ---- share links: #v=<deflated json, base64url> ----
  async function deflate(str) {
    if (typeof CompressionStream === 'undefined') return null;
    for (const fmt of ['deflate-raw', 'deflate']) {
      try {
        const cs = new CompressionStream(fmt);
        const buf = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
        return { fmt: fmt === 'deflate-raw' ? 'z' : 'd', bytes: new Uint8Array(buf) };
      } catch (e) { /* try next */ }
    }
    return null;
  }
  async function inflate(bytes, fmt) {
    const ds = new DecompressionStream(fmt === 'z' ? 'deflate-raw' : 'deflate');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  async function shareURL(valley, lanterns) {
    const data = RS.model.serialize(valley);
    if (lanterns) data.lanterns = lanterns.map((o) => [valley.streams.findIndex((s) => s.id === o.sid), Math.round(o.u * 100) / 100, o.held ? 1 : 0]).filter((x) => x[0] >= 0);
    delete data.id;
    const json = JSON.stringify(data);
    const z = await deflate(json);
    const code = z ? z.fmt + RS.util.bytesToB64url(z.bytes) : 'j' + RS.util.bytesToB64url(new TextEncoder().encode(json));
    const here = location.href.split('#')[0];
    const base = /^https?:/.test(location.protocol) && /github\.io$/.test(location.hostname) ? here : 'https://erenciracioglu-dotcom.github.io/Riversong/';
    return base + '#v=' + code;
  }
  async function fromHash() {
    const m = /[#&]v=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (!m) return null;
    try {
      const code = m[1], kind = code[0], bytes = RS.util.b64urlToBytes(code.slice(1));
      const json = kind === 'j' ? new TextDecoder().decode(bytes) : await inflate(bytes, kind);
      const o = JSON.parse(json);
      o.id = RS.util.uid('v');
      const v = RS.model.deserialize(o);
      return v;
    } catch (e) {
      console.warn('could not read shared valley', e);
      return null;
    }
  }
  return { index, save, load, raw, rename, remove, current, setCurrent, shareURL, fromHash };
})();

// ---------- the atlas of valleys ----------
RS.atlas = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function open() {
    RS.app.saveNow(true);
    render();
    $('atlas').classList.add('open');
    RS.input.dropTool();
  }
  function close() { $('atlas').classList.remove('open'); RS.render.home(); }
  function render() {
    const T = RS.i18n.t();
    const el = $('atlas');
    const cur = RS.app.valley && RS.app.valley.id;
    const idx = RS.store.index();
    const loc = RS.i18n.lang === 'tr' ? 'tr-TR' : 'en-GB';
    const cards = idx.map((e) => `
      <div class="card${e.id === cur ? ' current' : ''}" data-id="${esc(e.id)}">
        <div class="thumb" data-act="open">${e.thumb ? `<img src="${e.thumb}" alt="">` : '<div class="blank"></div>'}</div>
        <div class="name" contenteditable="true" spellcheck="false" data-act="name" title="${esc(T.rename)}">${esc(e.name || '…')}</div>
        <div class="meta">${new Date(e.updated || Date.now()).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        <div class="btns"><button data-act="share">${esc(T.share)}</button><button data-act="del">${esc(T.del)}</button></div>
      </div>`).join('');
    el.innerHTML = `<div class="atlas-inner">
      <header><h1>${esc(T.atlasTitle)}</h1><div class="actions"><button data-act="lang">${esc(T.lang)}</button><button data-act="close">${esc(T.back)}</button></div></header>
      <div class="grid"><div class="card new" data-act="new"><div class="thumb new" data-act="new"><span data-act="new">+</span></div><div class="name" data-act="new">${esc(T.newValley)}</div></div>${cards}</div>
      <p class="credits">${esc(T.credits)}</p></div>`;
    el.onclick = onClick;
    el.querySelectorAll('.name[contenteditable]').forEach((n) => {
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); n.blur(); } e.stopPropagation(); });
      n.addEventListener('blur', () => {
        const id = n.closest('.card').getAttribute('data-id');
        const name = n.textContent.trim().slice(0, 60) || '…';
        if (RS.app.valley && id === RS.app.valley.id) { RS.app.valley.name = name; RS.app.saveNow(false); }
        else RS.store.rename(id, name);
      });
    });
  }
  async function onClick(e) {
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').getAttribute('data-act');
    const card = e.target.closest('.card');
    const id = card && card.getAttribute('data-id');
    const T = RS.i18n.t();
    if (!act) { if (e.target.id === 'atlas') close(); return; }
    if (act === 'close') close();
    else if (act === 'lang') { RS.i18n.toggle(); render(); }
    else if (act === 'new') { RS.app.newValley(); close(); }
    else if (act === 'open' && id) { if (!RS.app.valley || id !== RS.app.valley.id) RS.app.openById(id); close(); }
    else if (act === 'del' && id) {
      const btn = e.target.closest('[data-act]');
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed'); btn.textContent = T.confirmDel;
        setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = T.del; } }, 4000);
        return;
      }
      const wasCur = RS.app.valley && id === RS.app.valley.id;
      RS.store.remove(id);
      if (wasCur) { const rest = RS.store.index(); if (rest.length) RS.app.openById(rest[0].id, true); else RS.app.newValley(true); }
      render();
    } else if (act === 'share' && id) {
      let v = id === (RS.app.valley && RS.app.valley.id) ? RS.app.valley : RS.store.load(id);
      if (!v) return;
      const lan = v === RS.app.valley ? RS.app.lanternSnapshot() : (v.lanterns || []);
      const url = await RS.store.shareURL(v, lan);
      try { await navigator.clipboard.writeText(url); RS.ui.showToast(T.copied); }
      catch (err) { showLink(url); }
    }
  }
  // where the clipboard is refused: show the link to copy by hand
  function showLink(url) {
    const T = RS.i18n.t();
    const inner = document.querySelector('#atlas .atlas-inner');
    if (!inner) return;
    let box = inner.querySelector('.linkbox');
    if (!box) { box = document.createElement('div'); box.className = 'linkbox'; inner.insertBefore(box, inner.children[1]); }
    box.innerHTML = '<span></span><input readonly>';
    box.querySelector('span').textContent = T.copyFail;
    const inp = box.querySelector('input');
    inp.value = url;
    inp.addEventListener('focus', () => inp.select());
    inp.focus();
  }
  return { open, close, render };
})();
