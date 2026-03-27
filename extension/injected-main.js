
(() => {
  const LOG = '[GhostPrompt v10.16.1/page]';
  let mode = 'pro';
  let protectionReal = true;
  let fallbackReason = '';
  const TOKEN_RE = /\[\[(GP_[A-Z0-9_]+_[a-f0-9]{12})\]\]/g;
  const TOKEN_LITERAL_RE = /\[\[GP_[A-Z0-9_]+_[a-f0-9]{12}\]\]/g;
  const state = {
    tokenByTypeAndValue: new Map(),
    reverseMap: new Map(),
    entriesByToken: new Map(),
    sessionKey: '',
  };

  function log(...args) { console.log(LOG, ...args); }

  window.addEventListener('ghostprompt:setMode', (event) => {
    mode = event.detail?.mode === 'pro' ? 'pro' : 'ui';
    protectionReal = event.detail?.protectionReal !== false;
    fallbackReason = event.detail?.fallbackReason || '';
    log('Modo actualizado:', mode, 'real=', protectionReal, fallbackReason ? `reason=${fallbackReason}` : '');
  });

  window.addEventListener('ghostprompt:clearMaps', (event) => {
    state.tokenByTypeAndValue.clear();
    state.reverseMap.clear();
    state.sessionKey = event.detail?.sessionKey || '';
    log('Mapas limpiados para sesión:', state.sessionKey || 'sin-id');
  });

  async function stableHash(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  }

  
  function isLikelyClabe(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 18;
  }


  function normalizeName(value) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function canonicalizeNameForToken(value) {
    return normalizeName(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

    const strong = new Set(['CLABE', 'CREDIT', 'CREDIT_CARD', 'RFC', 'CURP', 'EMAIL', 'PHONE', 'IBAN', 'SWIFT_BIC', 'API_KEY', 'URL_WITH_TOKEN', 'CRYPTO_WALLET']);
  const NAME_STOPLIST = new Set([
    'ChatGPT', 'GhostPrompt', 'OpenAI', 'Mexico', 'México', 'CLABE', 'RFC', 'CURP', 'EMAIL', 'PHONE',
    'Tarjeta', 'Cuenta', 'Banco', 'Correo', 'Telefono', 'Teléfono', 'Nombre', 'Apellido', 'Prompt',
    'Validación', 'Validacion', 'Stealth', 'Protección', 'Proteccion', 'Modo', 'Sesión', 'Sesion',
    'Lunes', 'Martes', 'Miércoles', 'Miercoles', 'Jueves', 'Viernes', 'Sábado', 'Sabado', 'Domingo',
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ]);
  const NAME_PART_STOPLIST = new Set([
    'Mi', 'Mis', 'Tu', 'Tus', 'Su', 'Sus', 'El', 'La', 'Los', 'Las', 'Un', 'Una',
    'Y', 'De', 'Del', 'Para', 'Con', 'Sin', 'Por', 'En', 'Lo', 'Que', 'Esto', 'Ese', 'Esta'
  ]);
  const COMMON_NON_NAME_PHRASES = [
    /\bmi\s+correo\b/i, /\bmi\s+tel[eé]fono\b/i, /\bcorreo\s+electr[oó]nico\b/i,
    /\bcuenta\s+bancaria\b/i, /\bvalidaci[oó]n\s+de\b/i, /\bprotecci[oó]n\s+invisible\b/i,
    /\bdatos\s+protegidos\b/i, /\bestealth\s+activo\b/i
  ];

  
  function stripTrailingNameConnectors(value) {
    return value
      .replace(/\s+/g, ' ')
      .replace(/\b(y|e|de|del|la|las|los)\b\s*$/i, '')
      .trim();
  }


  function isCleanNameToken(part) {
    return /^[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,20}$/.test(part);
  }

  function normalizeNameForMatch(value) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function accentAgnosticCharClass(ch) {
    const map = {
      a: '[aáàäâãå]',
      e: '[eéèëê]',
      i: '[iíìïî]',
      o: '[oóòöôõ]',
      u: '[uúùüû]',
      n: '[nñ]',
      c: '[cç]'
    };
    return map[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildAccentInsensitiveNameRegex(normalizedName) {
    const source = normalizedName
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.split('').map(accentAgnosticCharClass).join(''))
      .join('\\s+');
    return new RegExp(`\\b${source}\\b`, 'giu');
  }

  function isValidDetectedName(value) {
    const normalized = normalizeNameForMatch(value);
    if (!normalized) return false;
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return false;
    if (parts.some((p) => p.length < 2 || p.length > 20)) return false;
    return parts.every((p) => /^[a-z]+$/.test(p));
  }


  function isExpandedVariantName(candidateNorm, baseNorm) {
    if (!candidateNorm || !baseNorm || candidateNorm === baseNorm) return false;

    const cand = candidateNorm.split(/\s+/).filter(Boolean);
    const base = baseNorm.split(/\s+/).filter(Boolean);
    if (cand.length !== base.length || cand.length < 2) return false;

    let expandedCount = 0;
    for (let i = 0; i < cand.length; i += 1) {
      if (cand[i] === base[i]) continue;
      if (cand[i].startsWith(base[i]) && cand[i].length >= base[i].length + 3) {
        expandedCount += 1;
        continue;
      }
      return false;
    }
    return expandedCount >= 1;
  }

function toTitleCaseName(value) {
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part)
      .join(' ');
  }

  function isLikelyPersonName(value, text = '', start = -1, end = -1) {
    if (!value) return false;
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 5 || trimmed.length > 60) return false;
    if (/\d/.test(trimmed) || trimmed.includes('@') || trimmed.includes('[[')) return false;
    if (COMMON_NON_NAME_PHRASES.some((re) => re.test(trimmed))) return false;

    const parts = trimmed.split(' ');
    if (parts.length < 2 || parts.length > 3) return false;
    if (parts.some((p) => NAME_STOPLIST.has(p) || NAME_PART_STOPLIST.has(p))) return false;

    const ok = parts.every((part) =>
      /^(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+-[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)$/.test(part)
    );
    if (!ok) return false;

    if (text && start >= 0 && end >= 0) {
      const left = text.slice(Math.max(0, start - 16), start);
      const right = text.slice(end, Math.min(text.length, end + 20));
      if (/[:#\[]\s*$/.test(left)) return false;
      if (/^(?:\s*[:#\]])/.test(right)) return false;
      if (/\b(?:estado|modo|sesi[oó]n|correo|tel[eé]fono|clabe|rfc|curp|email|phone)\s*$/i.test(left.trim())) return false;
    }
    return isValidDetectedName(trimmed);
  }

  function overlapsExisting(start, end, detections) {
    return detections.some((d) => !(end <= d.start || start >= d.end));
  }

  function getProtectedTokenRanges(text) {
    const ranges = [];
    TOKEN_LITERAL_RE.lastIndex = 0;
    let match;
    while ((match = TOKEN_LITERAL_RE.exec(text))) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    TOKEN_LITERAL_RE.lastIndex = 0;
    return ranges;
  }

  function overlapsRange(start, end, ranges) {
    return ranges.some((r) => !(end <= r.start || start >= r.end));
  }

  function maskProtectedTokens(text) {
    return text.replace(TOKEN_LITERAL_RE, (m) => ' '.repeat(m.length));
  }

  function detectionPriority(item) {
    const table = {
      URL_WITH_TOKEN: 200, API_KEY: 195, EMAIL: 190, CURP: 185, RFC: 180, CLABE: 178, IBAN: 176, SWIFT_BIC: 174, PASSPORT: 172, CREDIT_CARD: 170, CREDIT: 168, PHONE: 160, NAME: 120
    };
    return table[item.type] || 80;
  }

  function mergeAndFilterDetections(detections) {
    const unique = [];
    const seen = new Set();

    for (const item of detections) {
      const key = `${item.start}:${item.end}:${item.type}:${normalizeValue(item.type, item.value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    unique.sort((a, b) => {
      const pri = detectionPriority(b) - detectionPriority(a);
      if (pri) return pri;
      const len = (b.end - b.start) - (a.end - a.start);
      if (len) return len;
      return a.start - b.start;
    });

    const selected = [];
    for (const item of unique) {
      if (selected.some((prev) => !(item.end <= prev.start || item.start >= prev.end))) continue;
      selected.push(item);
    }

    selected.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    return selected;
  }


  function detectNamePhrases(text, detections, protectedRanges = getProtectedTokenRanges(text)) {
    const scanText = maskProtectedTokens(text);
    const contextualPatterns = [
      /\bmi\s+nombre\s+es\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,2})\b/gi,
      /\bsoy\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,2})\b/gi,
    ];

    const rawMatches = [];
    const contextNormalized = new Set();

    function enqueueName(rawValue, start, end, source = 'generic') {
      let value = stripTrailingNameConnectors(toTitleCaseName(rawValue));
      const normalized = normalizeNameForMatch(value);
      if (!normalized) return;
      if (overlapsRange(start, end, protectedRanges)) return;
      if (!isLikelyPersonName(value, text, start, end)) return;
      if (!isValidDetectedName(value)) return;
      rawMatches.push({ start, end, type: 'NAME', value, normalized, source });
      if (source === 'context') contextNormalized.add(normalized);
    }

    // 1) contexto: admite minúsculas tras "mi nombre es"/"soy"
    for (const re of contextualPatterns) {
      let m;
      while ((m = re.exec(scanText))) {
        const raw = m[1];
        const rel = m[0].toLowerCase().indexOf(raw.toLowerCase());
        const start = m.index + Math.max(0, rel);
        const end = start + raw.length;
        enqueueName(raw, start, end, 'context');
      }
    }

    // 2) genérico: solo capitalizados para evitar ruido
    const genericNameRe = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})\b/g;
    let m;
    while ((m = genericNameRe.exec(scanText))) {
      const raw = m[1];
      const start = m.index;
      const end = start + raw.length;
      let value = stripTrailingNameConnectors(toTitleCaseName(raw));
      const normalized = normalizeNameForMatch(value);
      if (!normalized) continue;

      // Si el candidato es una variante expandida de un nombre contextual ya confirmado,
      // descartarlo: "Jessica Hernandezandez" no debe crear otro token.
      const expandedAgainstContext = Array.from(contextNormalized).some((base) =>
        isExpandedVariantName(normalized, base)
      );
      if (expandedAgainstContext) {
        log('skip NAME (expanded variant)', normalized);
        continue;
      }

      enqueueName(raw, start, end, 'generic');
    }

    if (!rawMatches.length) return;

    // Dedupe exacto por rango + normalized
    const exactSeen = new Set();
    let names = rawMatches.filter((item) => {
      const key = `${item.start}:${item.end}:${item.normalized}`;
      if (exactSeen.has(key)) return false;
      exactSeen.add(key);
      return true;
    });

    // Entre nombres que comparten base, conservar el más canónico/corto.
    names = names.filter((item) => {
      return !names.some((other) => {
        if (other === item) return false;
        if (other.source !== 'context') return false;
        return isExpandedVariantName(item.normalized, other.normalized);
      });
    });

    const confirmed = new Map();
    for (const item of names) {
      const existing = confirmed.get(item.normalized);
      if (!existing || item.value.length < existing.value.length) {
        confirmed.set(item.normalized, item);
      }
    }

    // Segunda pasada estricta: ocurrencias exactas, insensibles a acentos y espacios.
    for (const [normalizedName, canonical] of confirmed.entries()) {
      const re = buildAccentInsensitiveNameRegex(normalizedName);
      let match;
      while ((match = re.exec(scanText))) {
        const rawMatch = match[0];
        const start = match.index;
        const end = start + rawMatch.length;
        const leftChar = start > 0 ? text[start - 1] : '';
        const rightChar = end < text.length ? text[end] : '';
        if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(leftChar) || /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(rightChar)) continue;
        if (overlapsRange(start, end, protectedRanges)) continue;
        if (normalizeNameForMatch(rawMatch) !== normalizedName) continue;
        detections.push({ start, end, type: 'NAME', value: canonical.value });
      }
    }

    detections.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  }

  function collectDetections(text) {
    const detections = [];
    const protectedRanges = getProtectedTokenRanges(text);
    const scanText = maskProtectedTokens(text);
    const regexes = [
      { type: 'EMAIL', re: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g },
      { type: 'CLABE', re: /\b\d{18}\b/g },
      { type: 'CURP', re: /\b[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d\b/g },
      { type: 'RFC', re: /\b(?:[A-ZÑ&]{3,4})\d{6}[A-Z0-9]{3}\b/g },
      { type: 'CREDIT', re: /\b(?:\d[ -]?){13,19}\b/g },
      { type: 'PHONE', re: /(?<!\d)(?:\+?52[\s-]?)?(?:\d[\s-]?){10,13}(?!\d)/g },
    ];

    for (const { type, re } of regexes) {
      let m;
      while ((m = re.exec(scanText))) {
        const value = m[0].trim();

        if (type === 'PHONE') {
          const digits = value.replace(/\D/g, '');
          if (digits.length < 10 || digits.length > 13) continue;
        }

        if (type === 'CREDIT') {
          const digits = value.replace(/\D/g, '');
          if (digits.length < 13 || digits.length > 19) continue;
          // 18 dígitos exactos: priorizar CLABE, no tarjeta.
          if (digits.length === 18) continue;
        }

        detections.push({ start, end, type, value });
      }
    }

    detectNamePhrases(text, detections, protectedRanges);

    return mergeAndFilterDetections(detections);
  }

  async function tokenFor(type, value) {
    const normalized = normalizeValue(type, value);
    const key = `${type}:${normalized}`;

    if (state.tokenByTypeAndValue.has(key)) {
      const reused = state.tokenByTypeAndValue.get(key);
      log('reuse', type, normalized, '→', reused);
      return reused;
    }

    const hashInput = type === 'NAME' ? normalized : key;
    const hash = await stableHash(hashInput);
    const token = `[[GP_${type}_${hash}]]`;

    state.tokenByTypeAndValue.set(key, token);

    if (!state.reverseMap.has(token)) {
      state.reverseMap.set(token, value);
    }

    if (!state.entriesByToken.has(token)) {
      state.entriesByToken.set(token, {
        token,
        type,
        value,
        normalized,
        masked: maskValue(type, value)
      });
    }

    log('create', type, normalized, '→', token);
    return token;
  }

  async function anonymizeText(text) {
    const detections = collectDetections(text);
    if (!detections.length) return { anonymized_text: text, detected: [] };

    const sorted = [...detections].sort((a, b) => b.start - a.start);
    let output = text;
    const detected = [];

    for (const d of sorted) {
      const token = await tokenFor(d.type, d.value);
      output = output.slice(0, d.start) + token + output.slice(d.end);
      detected.push({ type: d.type, value: d.value, token, masked: maskValue(d.type, d.value) });
    }

    detected.reverse();
    return { anonymized_text: output, detected };
  }

  function rehydrateText(text) {
    return text.replace(TOKEN_RE, (full) => state.reverseMap.get(full) || full);
  }

  function publish(entries) {
    if (!entries?.length) return;
    window.dispatchEvent(new CustomEvent('ghostprompt:networkProtected', { detail: { entries } }));
  }

  function isSafeChatPayload(url, payload) {
    if (!/\/backend-api\/(?:f\/)?conversation(?:$|[/?])/.test(url)) return false;
    if (!payload || typeof payload !== 'object') return false;
    if (!Array.isArray(payload.messages)) return false;
    return payload.messages.every((msg) =>
      msg && msg.content && Array.isArray(msg.content.parts) &&
      msg.content.parts.every((p) => typeof p === 'string')
    );
  }

  async function sanitizeConversationPayload(payload) {
    const clone = JSON.parse(JSON.stringify(payload));
    let detected = [];
    for (const msg of clone.messages) {
      const nextParts = [];
      for (const part of msg.content.parts) {
        const res = await anonymizeText(part);
        nextParts.push(res.anonymized_text);
        detected = detected.concat(res.detected);
      }
      msg.content.parts = nextParts;
    }
    return { payload: clone, detected };
  }


  function triggerFallback(reason) {
    if (mode === 'ui') return;
    mode = 'ui';
    protectionReal = false;
    fallbackReason = reason || 'network-error';
    window.dispatchEvent(new CustomEvent('ghostprompt:networkFallback', {
      detail: { reason: fallbackReason }
    }));
    log('Fallback automático activado:', fallbackReason);
  }

  function longestStartPrefixSuffix(text) {
    const prefixes = ['[[GP_', '[[GP', '[[G', '[[', '['];
    for (const prefix of prefixes) {
      if (text.endsWith(prefix)) return prefix.length;
    }
    return 0;
  }

  function isPotentialTokenPrefix(text) {
    return /^\[\[GP_[A-Z0-9_]{0,48}(?:_[a-f0-9]{0,12}(?:\]\]?)?)?$/.test(text);
  }

  class GhostSSETokenBuffer {
    constructor(reverseMap) {
      this.reverseMap = reverseMap;
      this.buffer = '';
    }

    push(chunk) {
      this.buffer += chunk;
      let output = '';

      while (this.buffer.length) {
        const start = this.buffer.indexOf('[[GP_');

        if (start === -1) {
          const keepLen = longestStartPrefixSuffix(this.buffer);
          const safe = this.buffer.slice(0, this.buffer.length - keepLen);
          output += rehydrateText(safe);
          this.buffer = this.buffer.slice(this.buffer.length - keepLen);
          break;
        }

        if (start > 0) {
          output += rehydrateText(this.buffer.slice(0, start));
          this.buffer = this.buffer.slice(start);
          continue;
        }

        const fullMatch = this.buffer.match(/^\[\[GP_[A-Z0-9_]+_[a-f0-9]{12}\]\]/);
        if (fullMatch) {
          output += rehydrateText(fullMatch[0]);
          this.buffer = this.buffer.slice(fullMatch[0].length);
          continue;
        }

        if (isPotentialTokenPrefix(this.buffer)) {
          break;
        }

        output += this.buffer[0];
        this.buffer = this.buffer.slice(1);
      }

      return output;
    }

    flush() {
      const out = rehydrateText(this.buffer);
      this.buffer = '';
      return out;
    }
  }

  function shouldWrapStreamingResponse(url, response) {
    if (mode !== 'pro') return false;
    if (!response || !response.ok || !response.body) return false;
    if (!state.reverseMap.size) return false;

    const contentType = response.headers.get('content-type') || '';
    return /text\/event-stream/i.test(contentType) || /\/backend-api\/(?:f\/)?conversation(?:$|[/?])/i.test(url || '');
  }

  function wrapStreamingResponse(url, response) {
    if (!shouldWrapStreamingResponse(url, response)) return response;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const rehydrator = new GhostSSETokenBuffer(state.reverseMap);
    const headers = new Headers(response.headers);
    headers.delete('content-length');

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const decoded = decoder.decode(value, { stream: true });
            const out = rehydrator.push(decoded);
            if (out) controller.enqueue(encoder.encode(out));
          }

          const trailing = decoder.decode();
          if (trailing) {
            const out = rehydrator.push(trailing);
            if (out) controller.enqueue(encoder.encode(out));
          }

          const flushed = rehydrator.flush();
          if (flushed) controller.enqueue(encoder.encode(flushed));
          controller.close();
        } catch (error) {
          try { reader.releaseLock(); } catch {}
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    });

    log('SSE rehydration activa para', url);

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }


  const TELEMETRY_BYPASS_HOSTS = new Set([
    'browser-intake-datadoghq.com',
    'rum.browser-intake-datadoghq.com'
  ]);

  function getUrlString(input) {
    if (input instanceof Request) return input.url || '';
    if (typeof input === 'string') return input;
    return input?.url || '';
  }

  function shouldShortCircuitTelemetry(url) {
    if (!url) return false;
    try {
      const parsed = new URL(String(url), location.href);
      return TELEMETRY_BYPASS_HOSTS.has(parsed.hostname) || parsed.hostname.includes('datadoghq.com');
    } catch {
      const raw = String(url);
      return raw.includes('browser-intake-datadoghq.com') || raw.includes('datadoghq.com');
    }
  }

  function telemetryNoopResponse() {
    return new Response('', { status: 204, statusText: 'No Content' });
  }

  const nativeFetch = window.fetch.bind(window);

  const nativeSendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator)
    : null;

  function installSendBeaconBypass() {
    if (!nativeSendBeacon) return;
    const wrappedSendBeacon = function(url, data) {
      if (shouldShortCircuitTelemetry(url)) {
        return true;
      }
      return nativeSendBeacon(url, data);
    };

    try {
      Object.defineProperty(Navigator.prototype, 'sendBeacon', {
        configurable: true,
        writable: true,
        value: wrappedSendBeacon
      });
    } catch {
      try {
        navigator.sendBeacon = wrappedSendBeacon;
      } catch {}
    }
  }

  installSendBeaconBypass();
  window.fetch = async function(input, init) {
    const url = getUrlString(input);

    if (shouldShortCircuitTelemetry(url)) {
      return telemetryNoopResponse();
    }

    if (mode !== 'pro') return nativeFetch(input, init);

    try {
      const req = input instanceof Request ? input : null;
      if (url.includes('/ces/') || url.includes('/telemetry/') || url.includes('/conversation/prepare') || url.includes('/api/auth/')) {
        return nativeFetch(input, init);
      }

      let bodyText = '';
      if (req) bodyText = await req.clone().text().catch(() => '');
      else if (typeof init?.body === 'string') bodyText = init.body;
      else return nativeFetch(input, init);

      if (!bodyText.trim().startsWith('{')) return nativeFetch(input, init);

      let parsed;
      try { parsed = JSON.parse(bodyText); } catch { return nativeFetch(input, init); }
      if (!isSafeChatPayload(url, parsed)) return nativeFetch(input, init);

      const sanitized = await sanitizeConversationPayload(parsed);
      if (!sanitized.detected.length) return nativeFetch(input, init);

      publish(sanitized.detected);
      const body = JSON.stringify(sanitized.payload);

      let response;
      if (req) {
        const rebuilt = new Request(req, { body });
        response = await nativeFetch(rebuilt);
      } else {
        response = await nativeFetch(input, { ...(init || {}), body });
      }

      if (!response.ok && (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 409 || response.status === 422)) {
        triggerFallback(`http-${response.status}`);
      }

      return wrapStreamingResponse(url, response);
    } catch (err) {
      triggerFallback(err?.message || 'exception');
      return nativeFetch(input, init);
    }
  };

  log('Hook v10.16 instalado');
})();
