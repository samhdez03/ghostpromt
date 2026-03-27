async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendMsg(type, data = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...data });
  } catch {
    return null;
  }
}

function setStatus(res) {
  const dot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const stateLine = document.getElementById('state-line');
  const toggle = document.getElementById('btn-toggle');
  const modeLine = document.getElementById('mode-line');
  const sessionLine = document.getElementById('session-line');
  const realIndicator = document.getElementById('real-indicator');

  if (!res) {
    dot.className = 'status-dot error';
    statusText.textContent = 'No activo en esta página';
    stateLine.textContent = 'Abre chatgpt.com para activar la protección.';
    if (modeLine) modeLine.textContent = 'Sin conexión con la página';
    if (sessionLine) sessionLine.textContent = 'Sin sesión activa';
    if (realIndicator) {
      realIndicator.textContent = 'SIN PROTECCIÓN REAL';
      realIndicator.style.color = '#FF6B6B';
    }
    toggle.disabled = true;
    return;
  }

  toggle.disabled = false;

  if (res.paused) {
    dot.className = 'status-dot paused';
    statusText.textContent = 'Protección pausada';
    stateLine.textContent = 'Stealth detenido. No se protegerán nuevos datos.';
    toggle.textContent = 'Activar';
  } else {
    dot.className = 'status-dot active';
    statusText.textContent = 'Stealth activo';
    stateLine.textContent = 'Protección invisible antes del envío.';
    toggle.textContent = 'Pausar';
  }

  if (modeLine) {
    modeLine.textContent = res?.mode === 'pro'
      ? 'Modo PRO automático: cambia a UI si detecta error de red.'
      : 'Modo automático (fallback UI por error detectado).';
  }

  if (sessionLine) {
    sessionLine.textContent = res?.sessionKey
      ? `Sesión aislada: ${res.sessionKey}`
      : 'Sesión aislada';
  }

  if (realIndicator) {
    if (res?.protectionReal) {
      realIndicator.textContent = 'PROTECCIÓN REAL ACTIVA';
      realIndicator.style.color = '#7CFFB2';
    } else {
      const why = res?.fallbackReason ? ` (${res.fallbackReason})` : '';
      realIndicator.textContent = `SIN PROTECCIÓN REAL${why}`;
      realIndicator.style.color = '#FF6B6B';
    }
  }
}

function renderEntries(entries) {
  const list = document.getElementById('pii-list');
  const empty = document.getElementById('empty-section');
  list.innerHTML = '';

  if (!entries?.length) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'pii-item';
    li.innerHTML = `<span class="pii-type">${entry.type}</span><span class="pii-value">${entry.masked || '***'}</span>`;
    list.appendChild(li);
  }
}

async function render() {
  const res = await sendMsg('GHOST_STATUS');
  setStatus(res);
  document.getElementById('count-protected').textContent = res?.tokenCount ?? 0;
  document.getElementById('count-sessions').textContent = res?.sessionCount ?? 1;
  renderEntries(res?.piiEntries ?? []);
}

document.getElementById('btn-toggle').addEventListener('click', async () => {
  await sendMsg('GHOST_TOGGLE');
  await render();
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  await sendMsg('GHOST_CLEAR');
  await render();
});

render();
setInterval(render, 1000);
