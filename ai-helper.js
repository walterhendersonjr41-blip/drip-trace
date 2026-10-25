/* Free AI helper — no key, no sign-up. Uses the keyless Pollinations text API.
   Usage: <script src="ai-helper.js"></script><script>AIHelper.init({...})</script> */
(function () {
  'use strict';
  var CFG = {}, history = [], busy = false, root, log, input, sendBtn;
  var REF = 'walts-apps';

  function clean(t) {
    t = String(t || '').split(/\n\s*(?:---+\s*\n\s*\*\*Sponsor|\*\*Sponsor|🌸)/)[0];
    t = t.split('\n').filter(function (l) { return !/pollinations\.ai/i.test(l); }).join('\n');
    return t.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`|#+\s/g, '')
      .replace(/^\s*[-*•]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
  }
  function timed(url, opts, ms) {
    var c = new AbortController(), to = setTimeout(function () { c.abort(); }, ms || 30000);
    opts = opts || {}; opts.signal = c.signal;
    return fetch(url, opts).finally(function () { clearTimeout(to); });
  }
  /* ask(system, user | messages[]) -> Promise<string>; rejects if the AI is busy. */
  async function ask(system, user, opt) {
    opt = opt || {};
    var msgs = Array.isArray(user) ? user.slice() : [{ role: 'user', content: String(user) }];
    msgs.unshift({ role: 'system', content: String(system || '') });
    var body = { model: 'openai', messages: msgs, private: true, referrer: REF, reasoning_effort: 'low' };
    if (opt.json) body.response_format = { type: 'json_object' };
    var waits = [3000, 8000, 0];
    for (var i = 0; i < 3; i++) {
      try {
        var r = await timed('https://text.pollinations.ai/openai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 45000);
        if (r.ok) { var d = await r.json(); var c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content; if (c) return opt.raw ? c : clean(c); }
      } catch (e) { }
      if (opt.onRetry) try { opt.onRetry(i + 1); } catch (e) { }
      await new Promise(function (res) { setTimeout(res, waits[i]); });
    }
    try {
      var convo = msgs.filter(function (m) { return m.role !== 'system'; }).slice(-6).map(function (m) { return (m.role === 'assistant' ? 'Assistant: ' : 'User: ') + m.content; }).join('\n').slice(-1500);
      var r2 = await timed('https://text.pollinations.ai/' + encodeURIComponent(convo) + '?model=openai&private=true&referrer=' + REF + '&system=' + encodeURIComponent(String(system).slice(0, 2000)), {}, 35000);
      if (r2.ok) { var t = (await r2.text()).trim(); if (t && t[0] !== '{') return opt.raw ? t : clean(t); }
    } catch (e) { }
    throw new Error('busy');
  }
  function parseJSON(t) {
    t = String(t || ''); var a = t.indexOf('{'), b = t.lastIndexOf('}');
    var a2 = t.indexOf('['), b2 = t.lastIndexOf(']');
    if (a2 > -1 && (a < 0 || a2 < a)) { a = a2; b = b2; }
    if (a < 0 || b < a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }

  function css() {
    var c = CFG.color || '#2563eb';
    var s = document.createElement('style');
    s.textContent =
      '#aih-fab{position:fixed;right:16px;bottom:' + (CFG.bottom || 18) + 'px;z-index:2147483000;border:0;border-radius:999px;background:' + c + ';color:#fff;font:700 18px/1 system-ui,sans-serif;padding:16px 22px;min-height:58px;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer}' +
      '#aih-fab:focus-visible,#aih button:focus-visible{outline:3px solid #facc15;outline-offset:2px}' +
      '#aih{position:fixed;inset:auto 0 0 0;z-index:2147483001;max-height:88vh;display:none;flex-direction:column;background:#fff;color:#111;border-radius:20px 20px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.35);font:17px/1.45 system-ui,sans-serif}' +
      '@media(min-width:700px){#aih{left:auto;right:20px;bottom:20px;width:420px;border-radius:20px}}' +
      '#aih.open{display:flex}#aih *{box-sizing:border-box}' +
      '#aih .h{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #e5e7eb}#aih .h b{flex:1;font-size:19px}' +
      '#aih .x{border:0;background:#f3f4f6;color:#111;border-radius:12px;min-width:48px;min-height:48px;font-size:22px;cursor:pointer}' +
      '#aih .log{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px;min-height:120px}' +
      '#aih .m{white-space:pre-wrap;padding:10px 14px;border-radius:14px;max-width:92%}#aih .u{align-self:flex-end;background:' + c + ';color:#fff}#aih .a{align-self:flex-start;background:#f3f4f6}' +
      '#aih .err{background:#fef3c7;color:#78350f}#aih .note{font-size:13px;color:#6b7280;padding:0 16px 6px}' +
      '#aih .chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 10px}#aih .chips button{border:2px solid ' + c + ';background:#fff;color:' + c + ';border-radius:999px;padding:10px 14px;min-height:46px;font:600 15px system-ui,sans-serif;cursor:pointer}' +
      '#aih .row{display:flex;gap:8px;padding:10px 16px 16px;border-top:1px solid #e5e7eb}#aih textarea{flex:1;resize:none;border:2px solid #d1d5db;border-radius:14px;padding:10px 12px;font:17px system-ui,sans-serif;min-height:52px;max-height:120px;color:#111;background:#fff}' +
      '#aih .send{border:0;border-radius:14px;background:' + c + ';color:#fff;font:700 17px system-ui,sans-serif;min-width:76px;min-height:52px;cursor:pointer}#aih .send:disabled{opacity:.5}' +
      '#aih .mini{border:0;background:none;color:' + c + ';font:600 14px system-ui,sans-serif;cursor:pointer;padding:4px 0;min-height:32px}';
    document.head.appendChild(s);
  }
  function add(cls, text) {
    var d = document.createElement('div'); d.className = 'm ' + cls; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function speak(t) {
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t.replace(/•/g, '')); u.rate = 0.95; speechSynthesis.speak(u); } catch (e) { }
  }
  function context() {
    var t = '';
    try { t = CFG.context ? String(CFG.context() || '') : ''; } catch (e) { }
    if (!t && CFG.pageContext !== false) {
      var el = document.querySelector(CFG.contextSelector || 'main') || document.body;
      var clone = el.cloneNode(true); var me = clone.querySelector('#aih'); if (me) me.remove();
      t = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ');
    }
    return t.slice(0, CFG.contextChars || 3500);
  }
  async function send(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    busy = true; sendBtn.disabled = true; input.value = '';
    add('u', text); var w = add('a', 'Thinking…');
    var ctx = context();
    var sys = (CFG.system || 'You are a helpful assistant.') +
      ' Answer in plain, friendly, simple words for someone reading on a phone. Keep it short (under 120 words) unless asked for more. No markdown tables.' +
      (CFG.note ? ' Remind the user that this is not professional advice when the question is medical, legal or financial.' : '') +
      (ctx ? '\n\nWhat is on the app screen right now (for context):\n' + ctx : '');
    history.push({ role: 'user', content: text });
    try {
      var slow = setTimeout(function () { w.textContent = 'Thinking… (the free AI is busy, waiting in line)'; }, 12000);
      var reply = await ask(sys, history.slice(-8)).finally(function () { clearTimeout(slow); });
      history.push({ role: 'assistant', content: reply });
      w.textContent = reply;
      var b = document.createElement('button'); b.className = 'mini'; b.textContent = '🔊 Read aloud'; b.onclick = function () { speak(reply); };
      w.appendChild(document.createElement('br')); w.appendChild(b);
    } catch (e) {
      history.pop();
      w.className = 'm a err'; w.textContent = 'The free AI is busy right now. Please try again in a minute.';
      var rb = document.createElement('button'); rb.className = 'mini'; rb.textContent = '↻ Try again';
      rb.onclick = function () { w.remove(); log.lastChild && log.lastChild.className.indexOf(' u') > -1 && log.lastChild.remove(); send(text); };
      w.appendChild(document.createElement('br')); w.appendChild(rb);
    }
    busy = false; sendBtn.disabled = false; log.scrollTop = log.scrollHeight;
  }
  function open(prefill) {
    root.classList.add('open'); fab.style.display = 'none';
    if (prefill) send(prefill); else setTimeout(function () { input.focus(); }, 50);
  }
  function close() { root.classList.remove('open'); fab.style.display = ''; try { speechSynthesis.cancel(); } catch (e) { } }
  var fab;
  function init(cfg) {
    CFG = cfg || {}; if (CFG.referrer) REF = CFG.referrer;
    if (document.readyState === 'loading') return document.addEventListener('DOMContentLoaded', function () { init(cfg); });
    css();
    fab = document.createElement('button'); fab.id = 'aih-fab'; fab.type = 'button'; fab.textContent = CFG.button || '✨ Ask AI';
    fab.setAttribute('aria-label', 'Open the free AI helper'); fab.onclick = function () { open(); };
    if (!CFG.noFab) document.body.appendChild(fab);
    root = document.createElement('section'); root.id = 'aih'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', CFG.title || 'AI helper');
    root.innerHTML = '<div class="h"><b></b><button class="x" type="button" aria-label="Close">✕</button></div><div class="log" aria-live="polite"></div><div class="chips"></div><div class="note"></div><div class="row"><textarea rows="1" placeholder="Type a question…" aria-label="Your question"></textarea><button class="send" type="button">Ask</button></div>';
    document.body.appendChild(root);
    root.querySelector('.h b').textContent = CFG.title || '✨ AI helper';
    root.querySelector('.x').onclick = close;
    log = root.querySelector('.log'); input = root.querySelector('textarea'); sendBtn = root.querySelector('.send');
    root.querySelector('.note').textContent = (CFG.note ? CFG.note + ' ' : '') + 'Free AI — can make mistakes.';
    add('a', CFG.greeting || 'Hi! Ask me anything about this app.');
    var chips = root.querySelector('.chips');
    (CFG.chips || []).forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = c[0]; b.onclick = function () { send(c[1] || c[0]); }; chips.appendChild(b);
    });
    sendBtn.onclick = function () { send(input.value); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('open')) close(); });
  }
  window.AIHelper = { init: init, ask: ask, open: open, close: close, send: send, clean: clean, parseJSON: parseJSON, speak: speak };
})();
