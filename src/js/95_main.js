/* Riversong — start-up: find a valley (shared link, last one, or the first-light demo) and let it flow. */
'use strict';
(async function boot() {
  const gl = document.getElementById('gl'), ui = document.getElementById('ui');
  document.documentElement.lang = RS.i18n.lang;
  RS.ui.init(ui);
  let ok = false;
  try { ok = RS.render.init(gl); } catch (e) { console.error(e); ok = false; }
  if (!ok) {
    const m = document.getElementById('nogl');
    m.textContent = RS.i18n.t().noWebgl;
    m.style.display = 'flex';
    return;
  }
  RS.input.attach(gl);
  RS.audio.create();
  let v = await RS.store.fromHash();
  if (v) {
    RS.store.save(v, v.lanterns);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// */ }
    setTimeout(() => RS.ui.showToast(RS.i18n.t().imported, 3500), 600);
  } else {
    const id = RS.store.current();
    v = id ? RS.store.load(id) : null;
    if (!v) { const idx = RS.store.index(); if (idx.length) v = RS.store.load(idx[0].id); }
  }
  if (!v) { v = RS.demo.make(); RS.store.save(v, v.lanterns); }
  RS.app.open(v);
  RS.app.start();
  RS.ui.setLoading(true, 0);
  try { await RS.audio.load((p) => RS.ui.setLoading(true, p)); } catch (e) { console.warn(e); }
  RS.ui.setLoading(false);
  RS.audio.resume();
  window.RS_READY = true;
})();
