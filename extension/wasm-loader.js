
(function() {
  'use strict';

  var _session = null;
  var _count   = 0;
  var _paused  = false;
  var _ready   = false;

  function log(msg) { console.log('[GhostPrompt] ' + msg); }

  function postReply(type, extra) {
    var p = { type: type };
    for (var k in extra) p[k] = extra[k];
    window.postMessage(p, '*');
  }

  function loadWasm(jsUrl, wasmUrl) {
    var s = document.createElement('script');
    s.src = jsUrl;
    s.onload = function() {
      wasm_bindgen(wasmUrl).then(function() {
        _session = new wasm_bindgen.GhostSession();
        _ready = true;
        log('WASM listo \u2713');
        window.postMessage({ type: 'GHOST_WASM_READY' }, '*');
      }).catch(function(err) { log('WASM error: ' + err); });
    };
    s.onerror = function() { log('Error cargando ghost_prompt.js desde: ' + jsUrl); };
    (document.head || document.documentElement).appendChild(s);
  }

  window.addEventListener('message', function(e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || !d.type) return;

    // Mensaje de inicio — content script envía las URLs
    if (d.type === 'GHOST_INIT') {
      if (!_ready) loadWasm(d.jsUrl, d.wasmUrl);
      return;
    }

    if (d.type === 'GHOST_ANONYMIZE') {
      if (!_session || _paused) {
        postReply('GHOST_ANONYMIZE_REPLY', { requestId: d.requestId, result: null });
        return;
      }
      try {
        var raw    = _session.anonymize(d.text || '');
        var result = JSON.parse(raw);
        _count += result.new_count || 0;
        postReply('GHOST_ANONYMIZE_REPLY', { requestId: d.requestId, result: result });
      } catch(ex) {
        postReply('GHOST_ANONYMIZE_REPLY', { requestId: d.requestId, result: null });
      }
      return;
    }

    if (d.type === 'GHOST_REHYDRATE') {
      if (!_session) {
        postReply('GHOST_REHYDRATE_REPLY', { requestId: d.requestId, text: d.text });
        return;
      }
      try {
        postReply('GHOST_REHYDRATE_REPLY', { requestId: d.requestId, text: _session.rehydrate(d.text || '') });
      } catch(ex) {
        postReply('GHOST_REHYDRATE_REPLY', { requestId: d.requestId, text: d.text });
      }
      return;
    }

    if (d.type === 'GHOST_GET_STATUS') {
      postReply('GHOST_STATUS_REPLY', {
        count:  _count,
        paused: _paused,
        fwdMap: (_count > 0 && _session) ? _session.export_forward_map() : '{}'
      });
      return;
    }

    if (d.type === 'GHOST_CLEAR_SESSION') {
      if (_session) _session.clear();
      _count = 0;
      postReply('GHOST_CLEAR_DONE', {});
      return;
    }

    if (d.type === 'GHOST_TOGGLE_PAUSE') {
      _paused = !_paused;
      postReply('GHOST_TOGGLE_REPLY', { paused: _paused });
      return;
    }
  });

  window.__ghostSession = {
    getCount:  function() { return _count; },
    getPaused: function() { return _paused; },
    isReady:   function() { return _ready; }
  };

})();
