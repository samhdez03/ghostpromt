(() => {
  const LOG = '[GhostPrompt v10.16.1]';
  const TOKEN_RE = /\[\[(GP_[A-Z0-9_]+_[a-f0-9]{12})\]\]/g;
  const TOKEN_LITERAL_RE = /\[\[GP_[A-Z0-9_]+_[a-f0-9]{12}\]\]/g;

  const state = {
    ready: true,
    paused: false,
    sessionCount: 1,
    entriesByToken: new Map(),
    tokenByTypeAndValue: new Map(),
    reverseMap: new Map(),
    lastComposerHash: '',
    lastProtectedAt: 0,
    mode: 'pro',
    sessionKey: '',
    protectionReal: true,
    fallbackReason: '',
  };

  function log(...args) {
    console.log(LOG, ...args);
  }

  function getSessionKey() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? `chat:${match[1]}` : `path:${location.pathname}`;
  }

  function emitSessionReset() {
    window.dispatchEvent(new CustomEvent('ghostprompt:clearMaps', { detail: { sessionKey: state.sessionKey } }));
  }


  function publishMode() {
    window.dispatchEvent(new CustomEvent('ghostprompt:setMode', {
      detail: {
        mode: state.mode,
        protectionReal: state.protectionReal,
        fallbackReason: state.fallbackReason,
      }
    }));
  }


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

function normalizeValue(type, value) {
    const trimmed = String(value || '').trim();
    if (type === 'EMAIL' || type === 'URL_WITH_TOKEN') return trimmed.toLowerCase();
    if (type === 'PHONE') {
      let digits = trimmed.replace(/\D/g, '');
      if (digits.startsWith('00')) digits = digits.slice(2);
      if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
      if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
      return digits;
    }
    if (type === 'NAME') return canonicalizeNameForToken(trimmed);
    if (/^(?:CLABE|CURP|RFC|CREDIT|CREDIT_CARD|CPF_BR|CNPJ_BR|DNI_AR|CUIL_AR|CEDULA_CO|RUT_CL|DNI_PE|SSN_US|EIN_US|ZIP_US|SIN_CA|NI_UK|DNI_ES|NIE_ES|NIF_ES|INSEE_FR|STEUER_DE|CF_IT|BSN_NL|PESEL_PL|AADHAR_IN|PAN_IN|NID_CN|TFN_AU|NRIC_SG|JMBG_BA|NATIONAL_ID_AE|ID_ZA|PASSPORT|IBAN|SWIFT_BIC|API_KEY|CRYPTO_WALLET|MAC_ADDRESS|IP_V4|IP_V6|GPS_COORDS)$/u.test(type)) {
      return trimmed.replace(/\s+/g, '').toUpperCase();
    }
    return trimmed;
  }

  function maskValue(type, value) {
    const str = String(value || '');
    if (type === 'EMAIL') {
      const [user, domain = ''] = str.split('@');
      return `${user.slice(0, 2)}***@${domain}`;
    }
    if (type === 'PHONE') return `${str.slice(0, 2)}***${str.slice(-2)}`;
    if (type === 'NAME') {
      const parts = str.split(/\s+/);
      return parts.map((p) => `${p.slice(0, 1)}***`).join(' ');
    }
    const compact = str.replace(/\s+/g, '');
    if (compact.length >= 8) return `${compact.slice(0, 4)}********${compact.slice(-4)}`;
    if (compact.length >= 4) return `${compact.slice(0, 1)}***${compact.slice(-1)}`;
    return '***';
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

  function pushDetection(detections, start, end, type, value) {
    if (start == null || end == null || start >= end) return;
    detections.push({ start, end, type, value });
  }

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
    /\bmi\s+correo\b/i,
    /\bmi\s+tel[eé]fono\b/i,
    /\bcorreo\s+electr[oó]nico\b/i,
    /\bcuenta\s+bancaria\b/i,
    /\bvalidaci[oó]n\s+de\b/i,
    /\bprotecci[oó]n\s+invisible\b/i,
    /\bdatos\s+protegidos\b/i,
    /\bestealth\s+activo\b/i
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

    const fullUpper = trimmed.toUpperCase();
    if (fullUpper === trimmed && trimmed.length > 8) return false;

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
      { type: 'PHONE', re: /(\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,5}[\s\-.]?\d{4,6}/g },
      { type: 'CREDIT_CARD', re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g },
      { type: 'IP_V4', re: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
      { type: 'IP_V6', re: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g },
      { type: 'PASSPORT', re: /\b[A-Z]{1,2}[0-9]{6,9}\b/g },
      { type: 'IBAN', re: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}(?:[A-Z0-9]?){0,16}\b/g },
      { type: 'SWIFT_BIC', re: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g },
      { type: 'GPS_COORDS', re: /-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g },
      { type: 'URL_WITH_TOKEN', re: /https?:\/\/[^\s]+[?&](?:token|key|api_key|access_token|secret|password)=[^\s&]+/gi },
      { type: 'API_KEY', re: /(?:api[_\-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*['"`]?([A-Za-z0-9\-_.]{8,})/gi, valueIndex: 0 },
      { type: 'CRYPTO_WALLET', re: /\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/g },
      { type: 'MAC_ADDRESS', re: /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g },
      { type: 'CURP', re: /\b[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d\b/g },
      { type: 'RFC', re: /\b(?:[A-ZÑ&]{3,4})\d{6}[A-Z0-9]{3}\b/g },
      { type: 'CLABE', re: /\b\d{18}\b/g },
      { type: 'CPF_BR', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
      { type: 'CNPJ_BR', re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g },
      { type: 'DNI_AR', re: /\b\d{2}\.\d{3}\.\d{3}\b/g },
      { type: 'CUIL_AR', re: /\b(?:20|23|24|27|30|33|34)-\d{8}-\d\b/g },
      { type: 'CEDULA_CO', re: /\b\d{8,10}\b/g },
      { type: 'RUT_CL', re: /\b\d{7,8}-[0-9Kk]\b/g },
      { type: 'DNI_PE', re: /\b\d{8}\b/g },
      { type: 'SSN_US', re: /\b\d{3}-\d{2}-\d{4}\b/g },
      { type: 'EIN_US', re: /\b\d{2}-\d{7}\b/g },
      { type: 'ZIP_US', re: /\b\d{5}(?:-\d{4})?\b/g },
      { type: 'SIN_CA', re: /\b\d{3}[\s\-]\d{3}[\s\-]\d{3}\b/g },
      { type: 'NI_UK', re: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g },
      { type: 'DNI_ES', re: /\b\d{8}[A-Z]\b/g },
      { type: 'NIE_ES', re: /\b[XYZ]\d{7}[A-Z]\b/g },
      { type: 'NIF_ES', re: /\b[A-Z]\d{8}\b/g },
      { type: 'INSEE_FR', re: /\b[12]\d{2}(?:0[1-9]|1[0-2])\d{2}\d{3}\d{3}\d{2}\b/g },
      { type: 'STEUER_DE', re: /\b\d{2}\/\d{3}\/\d{5}\b/g },
      { type: 'CF_IT', re: /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/g },
      { type: 'BSN_NL', re: /\b\d{9}\b/g },
      { type: 'PESEL_PL', re: /\b\d{11}\b/g },
      { type: 'AADHAR_IN', re: /\b\d{4}[\s\-]\d{4}[\s\-]\d{4}\b/g },
      { type: 'PAN_IN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
      { type: 'NID_CN', re: /\b\d{17}[\dX]\b/g },
      { type: 'TFN_AU', re: /\b\d{3}[\s\-]\d{3}[\s\-]\d{3}\b/g },
      { type: 'NRIC_SG', re: /\b[STFG]\d{7}[A-Z]\b/g },
      { type: 'JMBG_BA', re: /\b\d{13}\b/g },
      { type: 'NATIONAL_ID_AE', re: /\b784-\d{4}-\d{7}-\d\b/g },
      { type: 'ID_ZA', re: /\b\d{13}\b/g },
      { type: 'CREDIT', re: /\b(?:\d[ -]?){13,19}\b/g },
    ];

    for (const { type, re, valueIndex } of regexes) {
      let m;
      while ((m = re.exec(scanText))) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (overlapsRange(start, end, protectedRanges)) continue;

        const value = (m[valueIndex || 0] || '').trim();
        if (!value) continue;

        if (type === 'PHONE') {
          const digits = value.replace(/\D/g, '');
          if (digits.length < 8 || digits.length > 15) continue;
        }

        if (type === 'CREDIT') {
          const digits = value.replace(/\D/g, '');
          if (digits.length < 13 || digits.length > 19) continue;
          if (digits.length === 18) continue;
        }

        detections.push({ start, end, type, value });
      }
    }

    detectNamePhrases(text, detections, protectedRanges);

    return mergeAndFilterDetections(detections);
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

  function getComposerCandidates() {
    return [
      document.querySelector('#prompt-textarea'),
      document.querySelector('[data-testid="prompt-textarea"]'),
      document.querySelector('textarea[data-id="root"]'),
      document.querySelector('div[contenteditable="true"][data-testid="prompt-textarea"]'),
      document.querySelector('div[contenteditable="true"]#prompt-textarea'),
      ...Array.from(document.querySelectorAll('div[contenteditable="true"]')),
      document.querySelector('textarea'),
    ].filter(Boolean);
  }

  function readComposer(el) {
    if (!el) return '';
    if (typeof el.value === 'string') return el.value;
    return (el.innerText || el.textContent || '').replace(/\u200b/g, '').trim();
  }

  function getComposerText() {
    for (const el of getComposerCandidates()) {
      const text = readComposer(el);
      if (text.trim()) return { el, text: text.trim() };
    }
    return { el: null, text: '' };
  }

  function setComposerText(el, value) {
    if (!el) return;
    el.focus();

    if (typeof el.value === 'string') {
      const setter = Object.getOwnPropertyDescriptor(el.__proto__ || HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.deleteContents();
    const textNode = document.createTextNode(value);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }

  function showBadge(text) {
    let badge = document.getElementById('ghostprompt-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'ghostprompt-badge';
      document.documentElement.appendChild(badge);
    }
    badge.textContent = text;
    badge.classList.add('show');
    clearTimeout(showBadge._t);
    showBadge._t = setTimeout(() => badge.classList.remove('show'), 2200);
  }

  async function protectComposer(reason) {
    if (state.paused || !state.ready) return false;
    const { el, text } = getComposerText();
    if (!el || !text) return false;

    const hash = await stableHash(text);
    if (hash === state.lastComposerHash) return false;

    const result = await anonymizeText(text);
    if (!result?.detected?.length) return false;

    state.lastComposerHash = await stableHash(result.anonymized_text);
    state.lastProtectedAt = Date.now();
    setComposerText(el, result.anonymized_text);
    showBadge(`${result.detected.length} dato(s) protegido(s)`);
    log('Protegido antes de enviar:', reason, result.detected.map(x => x.type).join(', '));
    return true;
  }

  function findSendButton() {
    return document.querySelector('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="Enviar"]');
  }

  function wireComposerInterception() {
    document.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      await protectComposer('enter');
    }, true);

    document.addEventListener('click', async (e) => {
      const button = e.target && e.target.closest && e.target.closest('button');
      if (!button) return;
      const sendButton = findSendButton();
      if (sendButton && button === sendButton) {
        await protectComposer('click');
      }
    }, true);
  }

  function shouldSkipNode(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest('#ghostprompt-badge')) return true;
    const tag = parent.tagName;
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA';
  }

  function rehydrateNode(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const replacements = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.includes('[[GP_') || shouldSkipNode(node)) continue;
      const rehydrated = rehydrateText(node.nodeValue);
      if (rehydrated !== node.nodeValue) replacements.push([node, rehydrated]);
    }
    for (const [node, value] of replacements) node.nodeValue = value;
  }

  function debounce(fn, ms = 240) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function isMessageRoot(node) {
    return !!(node && node.nodeType === Node.ELEMENT_NODE && (
      node.matches?.('[data-message-author-role]') ||
      node.closest?.('[data-message-author-role]')
    ));
  }

  function isStableMessage(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.querySelector?.('button[data-testid="stop-button"]')) return false;
    if (node.querySelector?.('[data-testid="stop-button"]')) return false;
    return true;
  }

  function safeRehydrateMessage(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.dataset.ghostProcessing === '1') return;
    if (!root.textContent || !root.textContent.includes('[[GP_')) return;
    if (!isStableMessage(root)) return;

    root.dataset.ghostProcessing = '1';
    try {
      rehydrateNode(root);
    } finally {
      setTimeout(() => {
        delete root.dataset.ghostProcessing;
      }, 120);
    }
  }

  function observeConversationTokens() {
    const processVisibleMessages = () => {
      document.querySelectorAll('[data-message-author-role="assistant"], [data-message-author-role="user"]').forEach((node) => {
        safeRehydrateMessage(node);
      });
    };

    const debouncedProcess = debounce(processVisibleMessages, 260);

    requestAnimationFrame(() => debouncedProcess());

    new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (isMessageRoot(node)) {
            shouldProcess = true;
            break;
          }
          if (node.nodeType === Node.ELEMENT_NODE && node.querySelector?.('[data-message-author-role]')) {
            shouldProcess = true;
            break;
          }
        }
        if (shouldProcess) break;
      }
      if (shouldProcess) debouncedProcess();
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function resetSession(reason = 'manual') {
    state.entriesByToken.clear();
    state.tokenByTypeAndValue.clear();
    state.reverseMap.clear();
    state.lastComposerHash = '';
    state.lastProtectedAt = 0;
    state.sessionKey = getSessionKey();
    emitSessionReset();
    state.sessionCount += 1;
    showBadge(reason === 'navigation' ? 'Nueva conversación detectada' : 'Sesión borrada');
  }

  function watchNavigation() {
    let lastSessionKey = getSessionKey();
    state.sessionKey = lastSessionKey;
    new MutationObserver(() => {
      const nextKey = getSessionKey();
      if (nextKey !== lastSessionKey) {
        lastSessionKey = nextKey;
        resetSession('navigation');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }


  function injectPageNetworkHook() {
    if (window.__ghostpromptHookInjected) return;
    window.__ghostpromptHookInjected = true;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected-main.js');
    script.dataset.ghostpromptSource = 'extension';
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }

  window.addEventListener('ghostprompt:networkProtected', (event) => {
    const items = event.detail?.entries || [];
    for (const entry of items) {
      if (!entry?.token) continue;
      state.reverseMap.set(entry.token, entry.value);
      state.entriesByToken.set(entry.token, {
        token: entry.token,
        type: entry.type,
        value: entry.value,
        masked: entry.masked || maskValue(entry.type, entry.value),
      });
      state.tokenByTypeAndValue.set(`${entry.type}:${normalizeValue(entry.type, entry.value)}`, entry.token);
    }
    if (items.length) showBadge(`${items.length} dato(s) protegido(s) en red`);
  });

  window.addEventListener('ghostprompt:networkRehydrate', (event) => {
    const payload = event.detail || {};
    if (!payload || !payload.text || !payload.selector) return;
    document.querySelectorAll(payload.selector).forEach((node) => {
      if (!node || !node.textContent || !node.textContent.includes('[[GP_')) return;
      safeRehydrateMessage(node);
    });
  });




  window.addEventListener('ghostprompt:networkFallback', (event) => {
    state.mode = 'ui';
    state.protectionReal = false;
    state.fallbackReason = event.detail?.reason || 'network-fallback';
    publishMode();
    showBadge('Fallback automático: Modo UI');
    log('auto-fallback a UI:', state.fallbackReason);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GHOST_SET_MODE') {
      // compat: aún aceptamos cambios manuales, pero la UI ya no lo expone
      state.mode = msg.mode === 'pro' ? 'pro' : 'ui';
      state.protectionReal = state.mode === 'pro';
      if (state.mode === 'pro') state.fallbackReason = '';
      publishMode();
      sendResponse({ ok: true, mode: state.mode });
      return true;
    }

    if (msg.type === 'GHOST_STATUS') {
      sendResponse({
        active: true,
        ready: state.ready,
        paused: state.paused,
        protecting: !state.paused,
        stealth: true,
        mode: state.mode,
        protectionReal: state.protectionReal,
        fallbackReason: state.fallbackReason,
        tokenCount: state.entriesByToken.size,
        sessionCount: state.sessionCount,
        sessionKey: state.sessionKey,
        piiEntries: Array.from(state.entriesByToken.values()).slice(-8).reverse(),
      });
      return true;
    }

    if (msg.type === 'GHOST_TOGGLE') {
      state.paused = !state.paused;
      showBadge(state.paused ? 'Protección pausada' : 'Protección activada');
      sendResponse({ ok: true, paused: state.paused });
      return true;
    }

    if (msg.type === 'GHOST_CLEAR') {
      resetSession('manual');
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'GHOST_EXPORT_SESSION') {
      sendResponse({
        ok: true,
        sessionKey: state.sessionKey,
        entries: Array.from(state.entriesByToken.values()),
        tokenMap: Array.from(state.tokenByTypeAndValue.entries()),
      });
      return true;
    }

    if (msg.type === 'GHOST_FORCE_SCAN') {
      const { text } = getComposerText();
      anonymizeText(text).then((result) => sendResponse({ ok: true, result })).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });

  injectPageNetworkHook();
  publishMode();
  wireComposerInterception();
  observeConversationTokens();
  watchNavigation();
  log('v10.16.1 listo en chatgpt.com (global patterns + NAME normalize → reuse → hash)');
})();
