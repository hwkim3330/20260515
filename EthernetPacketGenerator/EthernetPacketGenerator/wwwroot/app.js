const $ = (id) => document.getElementById(id);

const state = {
  interfaces: [],
  senderInterface: '',
  captureInterfaces: new Set(),
  captureRows: [],
  captureTimer: null,
  serialTimer: null,
  selectedGroupIndex: 0,
  selectedTestCaseIndex: null,
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, kind = 'info') {
  const tray = $('toastTray');
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  tray.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function setStatus(text, ok = true) {
  $('status').textContent = text;
  $('serverState').classList.toggle('bad', !ok);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function initTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      $(tab.dataset.view)?.classList.add('active');
    });
  });
}

async function refreshInterfaces() {
  const data = await api('/api/interfaces');
  state.interfaces = data.interfaces || [];
  renderSenderInterfaces();
  await refreshCaptureStatus();
  setStatus(`Connected - ${state.interfaces.length} interfaces`);
}

function renderSenderInterfaces() {
  const wrap = $('senderInterfaces');
  wrap.innerHTML = '';
  if (!state.interfaces.length) {
    wrap.innerHTML = '<p class="empty">No interfaces found.</p>';
    return;
  }

  for (const iface of state.interfaces) {
    const btn = document.createElement('button');
    btn.className = `chip ${iface.state === 'up' ? 'up' : 'down'}`;
    btn.textContent = `${iface.name} ${iface.state || ''}`;
    btn.title = `${iface.mac || ''}`;
    btn.addEventListener('click', () => {
      state.senderInterface = iface.name;
      document.querySelectorAll('#senderInterfaces .chip').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (!$('srcMac').value && iface.mac) $('srcMac').value = iface.mac;
      if (!$('srcIp').value && iface.ipv4?.[0]?.local) $('srcIp').value = iface.ipv4[0].local;
    });
    wrap.appendChild(btn);
  }
}

function buildProfile() {
  const profile = {
    protocol: $('protocol').value,
    interface: state.senderInterface || null,
    dstMac: $('dstMac').value.trim(),
    srcMac: $('srcMac').value.trim(),
    srcIp: $('srcIp').value.trim(),
    dstIp: $('dstIp').value.trim(),
    udp: {
      srcPort: Number($('srcPort').value) || 12345,
      dstPort: Number($('dstPort').value) || 50000,
    },
    count: Number($('count').value) || 1,
    intervalMs: Number($('intervalMs').value) || 0,
    payload: { mode: 'text', data: $('payload').value },
  };

  if ($('vlanEnabled').checked) {
    profile.vlan = {
      enabled: true,
      id: Number($('vlanId').value) || 100,
      priority: Number($('vlanPriority').value) || 0,
    };
  }
  return profile;
}

function formatHex(hex) {
  if (!hex) return '';
  const bytes = hex.match(/.{1,2}/g) || [];
  const out = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16);
    const ascii = chunk.map((b) => {
      const n = parseInt(b, 16);
      return n >= 32 && n <= 126 ? String.fromCharCode(n) : '.';
    }).join('');
    out.push(`${offset.toString(16).padStart(4, '0')}  ${chunk.join(' ').padEnd(47, ' ')}  ${ascii}`);
  }
  return out.join('\n');
}

async function previewFrame() {
  try {
    const data = await api('/api/build', { method: 'POST', body: JSON.stringify(buildProfile()) });
    const out = data.stdout || data;
    $('decoded').textContent = JSON.stringify(out.decoded || {}, null, 2);
    $('hexdump').textContent = formatHex(out.frameHex);
    toast('Preview updated', 'ok');
  } catch (err) {
    toast(`Build failed: ${err.message}`, 'bad');
  }
}

async function sendFrame() {
  if (!state.senderInterface) {
    toast('Select a sender interface first', 'warn');
    return;
  }
  try {
    const data = await api('/api/send', { method: 'POST', body: JSON.stringify(buildProfile()) });
    const out = data.stdout || data;
    toast(`Sent ${out.framesSent || 1} frame(s), ${out.bytesSent || '?'} bytes`, 'ok');
  } catch (err) {
    toast(`Send failed: ${err.message}`, 'bad');
  }
}

async function refreshCaptureStatus() {
  const data = await api('/api/capture/status');
  $('captureRunning').textContent = data.running ? 'capturing' : 'idle';
  $('captureTotal').textContent = `${data.totalPackets || 0} packets`;

  const list = $('captureInterfaces');
  list.innerHTML = '';
  state.captureInterfaces = new Set((data.interfaces || []).filter((i) => i.selected).map((i) => i.name));

  for (const iface of data.interfaces || []) {
    const label = document.createElement('label');
    label.className = 'check-row';
    label.innerHTML = `
      <input type="checkbox" ${iface.selected ? 'checked' : ''} value="${escapeHtml(iface.name)}">
      <span><strong>${escapeHtml(iface.name)}</strong><small>${escapeHtml(iface.description || iface.state || '')}</small></span>
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) state.captureInterfaces.add(iface.name);
      else state.captureInterfaces.delete(iface.name);
    });
    list.appendChild(label);
  }
}

async function startCapture() {
  try {
    await api('/api/capture/start', {
      method: 'POST',
      body: JSON.stringify({ interfaces: Array.from(state.captureInterfaces) }),
    });
    toast('Capture started', 'ok');
    startCapturePolling();
    await refreshCaptureStatus();
  } catch (err) {
    toast(`Capture start failed: ${err.message}`, 'bad');
  }
}

async function stopCapture() {
  await api('/api/capture/stop', { method: 'POST', body: '{}' });
  toast('Capture stopped', 'ok');
  await refreshCaptureStatus();
}

async function clearCapture() {
  await api('/api/capture/clear', { method: 'POST', body: '{}' });
  state.captureRows = [];
  renderCaptureRows();
  $('packetDetails').textContent = 'Select a packet.';
  $('packetHex').textContent = '';
  await refreshCaptureStatus();
}

function startCapturePolling() {
  if (state.captureTimer) clearInterval(state.captureTimer);
  state.captureTimer = setInterval(loadCapturePackets, 900);
  loadCapturePackets();
}

async function loadCapturePackets() {
  try {
    const data = await api('/api/capture/packets?limit=1000');
    state.captureRows = data.rows || [];
    renderCaptureRows();
    await refreshCaptureStatus();
  } catch {
    // keep UI stable if capture is temporarily unavailable
  }
}

function rowMatchesFilter(row, filter) {
  if (!filter) return true;
  const text = `${row.no} ${row.time} ${row.interfaceName} ${row.source} ${row.destination} ${row.protocol} ${row.length} ${row.info} ${row.srcMac} ${row.dstMac}`.toLowerCase();
  return filter.split(/\s+/).filter(Boolean).every((token) => {
    if (token.startsWith('mac:')) return `${row.srcMac} ${row.dstMac}`.toLowerCase().includes(token.slice(4));
    if (token.startsWith('ip:')) return `${row.source} ${row.destination}`.toLowerCase().includes(token.slice(3));
    if (token.startsWith('port:')) return `${row.source} ${row.destination} ${row.info}`.toLowerCase().includes(token.slice(5));
    return text.includes(token);
  });
}

function renderCaptureRows() {
  const tbody = $('captureRows');
  const filter = $('captureFilter').value.trim().toLowerCase();
  const rows = state.captureRows.filter((r) => rowMatchesFilter(r, filter));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No packets match.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r, idx) => `
    <tr data-index="${idx}" class="proto-${escapeHtml((r.protocol || '').toLowerCase())}">
      <td>${r.no}</td>
      <td>${escapeHtml(r.time)}</td>
      <td>${escapeHtml(r.interfaceName)}</td>
      <td>${escapeHtml(r.srcMac)}</td>
      <td>${escapeHtml(r.dstMac)}</td>
      <td>${escapeHtml(r.source)}</td>
      <td>${escapeHtml(r.destination)}</td>
      <td><strong>${escapeHtml(r.protocol)}</strong></td>
      <td>${r.length}</td>
      <td>${escapeHtml(r.info)}</td>
    </tr>
  `).join('');

  Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
    tr.addEventListener('click', () => {
      tbody.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
      tr.classList.add('selected');
      const row = rows[Number(tr.dataset.index)];
      $('packetDetails').textContent = row.detailText || 'No decoded detail.';
      $('packetHex').textContent = row.hexDump || '';
    });
  });
}

async function loadLogs() {
  try {
    const data = await api('/api/logs');
    $('logsBox').textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    $('logsBox').textContent = `Log load failed: ${err.message}`;
  }
}

async function loadTestCases() {
  try {
    const data = await api('/api/testcases/status');
    const tc = data.testCases || {};
    $('tcStatus').textContent = `${tc.status || ''} Selected: ${tc.selected || '(none)'}`;
    renderTestCaseTree(tc.groups || []);
    renderSequenceRows(tc.sequence || []);
  } catch (err) {
    $('tcStatus').textContent = `Test case load failed: ${err.message}`;
  }
}

function renderTestCaseTree(groups) {
  const root = $('tcTree');
  if (!groups.length) {
    root.innerHTML = '<p class="empty">No groups. Add one.</p>';
    return;
  }
  root.innerHTML = groups.map((g) => `
    <section class="tc-group">
      <div class="tc-group-head">
        <strong>${escapeHtml(g.name)}</strong>
        <button class="small danger tc-delete-group" data-group="${g.index}">Delete</button>
      </div>
      ${(g.testCases || []).map((t) => `
        <button class="tc-item ${t.selected ? 'selected' : ''}" data-group="${t.groupIndex}" data-tc="${t.index}">
          <span>${escapeHtml(t.name)}</span><small>${t.itemCount} items</small>
        </button>
      `).join('')}
    </section>
  `).join('');
  root.querySelectorAll('.tc-item').forEach((btn) => btn.addEventListener('click', async () => {
    state.selectedGroupIndex = Number(btn.dataset.group);
    state.selectedTestCaseIndex = Number(btn.dataset.tc);
    await api('/api/testcases/select', {
      method: 'POST',
      body: JSON.stringify({ groupIndex: state.selectedGroupIndex, testCaseIndex: state.selectedTestCaseIndex }),
    });
    await loadTestCases();
  }));
  root.querySelectorAll('.tc-delete-group').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this group?')) return;
    await api('/api/testcases/delete', { method: 'POST', body: JSON.stringify({ groupIndex: Number(btn.dataset.group) }) });
    await loadTestCases();
  }));
}

function renderSequenceRows(items) {
  const tbody = $('sequenceRows');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No sequence loaded.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map((item, i) => `
    <tr>
      <td>${i}</td>
      <td>${escapeHtml(item.kind)}</td>
      <td>${item.checked ? 'yes' : 'no'}</td>
      <td>${escapeHtml(item.packetName || item.eventType || '')}</td>
      <td colspan="4">${escapeHtml(item.eventType ? JSON.stringify(item) : `${(item.blocks || []).length} block(s)`)}</td>
    </tr>
  `).join('');
}

async function addTestCaseGroup() {
  await api('/api/testcases/add-group', { method: 'POST', body: JSON.stringify({ name: $('tcGroupName').value }) });
  $('tcGroupName').value = '';
  await loadTestCases();
}

async function addTestCaseFromCurrent() {
  await api('/api/testcases/add', {
    method: 'POST',
    body: JSON.stringify({ groupIndex: state.selectedGroupIndex || 0, name: $('tcName').value }),
  });
  $('tcName').value = '';
  await loadTestCases();
}

async function saveCurrentToSelected() {
  try {
    await api('/api/testcases/save-current', { method: 'POST', body: '{}' });
    toast('Current sequence saved to selected test case', 'ok');
    await loadTestCases();
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'bad');
  }
}

async function refreshRegisterStatus() {
  try {
    const data = await api('/api/register/status');
    $('regStatus').textContent = `${data.serialConnected ? 'Serial connected' : 'Serial disconnected'} - base ${data.baseAddress || ''}`;
  } catch (err) {
    $('regStatus').textContent = `Register bridge offline: ${err.message}`;
  }
}

async function readRegister() {
  try {
    const data = await api('/api/register/read', {
      method: 'POST',
      body: JSON.stringify({ offset: $('regOffset').value }),
    });
    $('regValue').value = data.value;
    $('regResult').textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    $('regResult').textContent = `Read failed: ${err.message}`;
    toast(`Register read failed: ${err.message}`, 'bad');
  }
}

async function writeRegister() {
  try {
    const data = await api('/api/register/write', {
      method: 'POST',
      body: JSON.stringify({ offset: $('regOffset').value, value: $('regValue').value }),
    });
    $('regResult').textContent = JSON.stringify(data, null, 2);
    toast('Register written', 'ok');
  } catch (err) {
    $('regResult').textContent = `Write failed: ${err.message}`;
    toast(`Register write failed: ${err.message}`, 'bad');
  }
}

function fdbPayload() {
  return {
    mac: $('fdbMac').value.trim(),
    port: Number($('fdbPort').value) || 0,
    vlanValid: $('fdbVlanValid').checked,
    vlanId: Number($('fdbVlanId').value) || 0,
  };
}

async function fdbCall(path, payload = fdbPayload()) {
  try {
    const data = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    $('fdbResult').textContent = JSON.stringify(data, null, 2);
    toast(data.status || 'FDB operation complete', 'ok');
  } catch (err) {
    $('fdbResult').textContent = `FDB failed: ${err.message}`;
    toast(`FDB failed: ${err.message}`, 'bad');
  }
}

async function refreshSerialStatus() {
  const data = await api('/api/serial/status');
  const t = data.terminal || {};

  const portSelect = $('serialPort');
  const currentPort = portSelect.value || t.selectedPort || '';
  portSelect.innerHTML = (t.ports || []).map((p) =>
    `<option value="${escapeHtml(p.portName || p.PortName)}">${escapeHtml(p.displayName || p.DisplayName || p.portName || p.PortName)}</option>`
  ).join('');
  if (currentPort) portSelect.value = currentPort;

  const baudSelect = $('serialBaud');
  const currentBaud = baudSelect.value || String(t.selectedBaudRate || 115200);
  baudSelect.innerHTML = (t.baudRates || [9600, 19200, 38400, 57600, 115200, 230400, 921600])
    .map((b) => `<option value="${b}">${b}</option>`).join('');
  baudSelect.value = currentBaud;

  $('serialState').textContent = t.connectionStatus || (t.isConnected ? 'connected' : 'disconnected');
  $('serialState').classList.toggle('connected', Boolean(t.isConnected));
  $('serialOutput').textContent = t.terminalOutput || 'No terminal output.';
  $('serialOutput').scrollTop = $('serialOutput').scrollHeight;
}

async function connectSerial() {
  try {
    await api('/api/serial/connect', {
      method: 'POST',
      body: JSON.stringify({
        port: $('serialPort').value,
        baudRate: Number($('serialBaud').value) || 115200,
      }),
    });
    toast('Serial connected', 'ok');
    await refreshSerialStatus();
  } catch (err) {
    toast(`Serial connect failed: ${err.message}`, 'bad');
  }
}

async function disconnectSerial() {
  await api('/api/serial/disconnect', { method: 'POST', body: '{}' });
  toast('Serial disconnected', 'ok');
  await refreshSerialStatus();
}

async function sendSerial() {
  const text = $('serialInput').value;
  if (!text.trim()) return;
  try {
    await api('/api/serial/send', { method: 'POST', body: JSON.stringify({ text }) });
    $('serialInput').value = '';
    await refreshSerialStatus();
  } catch (err) {
    toast(`Serial send failed: ${err.message}`, 'bad');
  }
}

async function clearSerial() {
  await api('/api/serial/clear', { method: 'POST', body: '{}' });
  await refreshSerialStatus();
}

async function init() {
  initTabs();
  $('refreshAll').addEventListener('click', refreshInterfaces);
  $('captureRefresh').addEventListener('click', refreshCaptureStatus);
  $('build').addEventListener('click', previewFrame);
  $('send').addEventListener('click', sendFrame);
  $('captureStart').addEventListener('click', startCapture);
  $('captureStop').addEventListener('click', stopCapture);
  $('captureClear').addEventListener('click', clearCapture);
  $('captureFilter').addEventListener('input', renderCaptureRows);
  $('refreshLogs').addEventListener('click', loadLogs);
  $('serialRefresh').addEventListener('click', refreshSerialStatus);
  $('serialConnect').addEventListener('click', connectSerial);
  $('serialDisconnect').addEventListener('click', disconnectSerial);
  $('serialSend').addEventListener('click', sendSerial);
  $('serialClear').addEventListener('click', clearSerial);
  $('serialInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendSerial();
  });
  $('regStatusRefresh').addEventListener('click', refreshRegisterStatus);
  $('regRead').addEventListener('click', readRegister);
  $('regWrite').addEventListener('click', writeRegister);
  $('fdbRead').addEventListener('click', () => fdbCall('/api/fdb/read'));
  $('fdbWrite').addEventListener('click', () => fdbCall('/api/fdb/write'));
  $('fdbDelete').addEventListener('click', () => fdbCall('/api/fdb/delete'));
  $('fdbFlush').addEventListener('click', () => {
    if (confirm('Flush all FDB entries?')) fdbCall('/api/fdb/flush', {});
  });
  $('tcRefresh').addEventListener('click', loadTestCases);
  $('tcAddGroup').addEventListener('click', addTestCaseGroup);
  $('tcAdd').addEventListener('click', addTestCaseFromCurrent);
  $('tcSaveCurrent').addEventListener('click', saveCurrentToSelected);
  ['protocol', 'dstMac', 'srcMac', 'srcIp', 'dstIp', 'srcPort', 'dstPort', 'payload', 'vlanEnabled', 'vlanId', 'vlanPriority'].forEach((id) => {
    $(id)?.addEventListener('change', previewFrame);
  });

  try {
    await api('/api/health');
    await refreshInterfaces();
    await loadLogs();
    await refreshSerialStatus();
    await refreshRegisterStatus();
    await loadTestCases();
    startCapturePolling();
    state.serialTimer = setInterval(refreshSerialStatus, 1500);
  } catch (err) {
    setStatus(`Offline - ${err.message}`, false);
    toast(`Server not reachable: ${err.message}`, 'bad');
  }

  // ── Peer PC 제어 ────────────────────────────────────────────────────────────
  initPeerControls();
}

// ── Peer PC 상태 ──────────────────────────────────────────────────────────────
const peer = {
  url: localStorage.getItem('peerUrl') || '',
  captureInterfaces: new Set(),
};

function peerApi(path, options = {}) {
  const peerPath = '/api/peer' + path;
  return api(peerPath, options);
}

async function probePeer() {
  const url = $('peerUrl').value.trim();
  if (!url) { toast('Peer URL을 입력하세요.', 'warn'); return; }

  try {
    // 서버에 Peer URL 설정
    await api('/api/peer/url', { method: 'POST', body: JSON.stringify({ url }) });
    localStorage.setItem('peerUrl', url);
    peer.url = url;

    // Peer health 확인
    const health = await peerApi('/health');
    $('peerState').classList.add('ok');
    $('peerLabel').textContent = `Peer: connected`;
    toast(`Peer 연결 성공: ${health.service || 'OK'}`, 'ok');

    // Peer 인터페이스 로드
    await loadPeerInterfaces();
  } catch (err) {
    $('peerState').classList.remove('ok');
    $('peerLabel').textContent = 'Peer: offline';
    toast(`Peer 연결 실패: ${err.message}`, 'bad');
  }
}

async function loadPeerInterfaces() {
  try {
    const data = await peerApi('/interfaces');
    const list = $('peerCaptureInterfaces');
    list.innerHTML = '';
    peer.captureInterfaces.clear();

    for (const iface of data.interfaces || []) {
      const label = document.createElement('label');
      label.className = 'check-row';
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(iface.name)}">
        <span><strong>${escapeHtml(iface.name)}</strong>
        <small>${escapeHtml(iface.mac || '')} ${iface.state === 'up' ? '▲' : '▼'}</small></span>
      `;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) peer.captureInterfaces.add(iface.name);
        else peer.captureInterfaces.delete(iface.name);
      });
      list.appendChild(label);
    }
    $('peerCaptureState').classList.add('ok');
  } catch (err) {
    $('peerCaptureInterfaces').innerHTML = `<p class="empty" style="font-size:12px;color:var(--danger,red)">${escapeHtml(err.message)}</p>`;
  }
}

async function startPeerCapture() {
  try {
    const ifaces = Array.from(peer.captureInterfaces);
    await peerApi('/capture/start', {
      method: 'POST',
      body: JSON.stringify({ interfaces: ifaces }),
    });
    toast('Peer 캡처 시작', 'ok');
  } catch (err) {
    toast(`Peer 캡처 시작 실패: ${err.message}`, 'bad');
  }
}

async function stopPeerCapture() {
  try {
    await peerApi('/capture/stop', { method: 'POST', body: '{}' });
    toast('Peer 캡처 중지', 'ok');
  } catch (err) {
    toast(`Peer 캡처 중지 실패: ${err.message}`, 'bad');
  }
}

async function fetchPeerPackets() {
  try {
    const data = await peerApi('/capture/packets?limit=500');
    const rows = data.rows || [];
    toast(`Peer에서 ${rows.length}개 패킷 수신`, 'ok');

    // 기존 캡처 테이블에 Peer 패킷 추가 (구분 표시)
    if (rows.length === 0) return;

    const tbody = $('captureRows');
    if (tbody.querySelector('.empty')) tbody.innerHTML = '';

    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.style.background = 'rgba(14,140,200,0.06)'; // peer 패킷은 파란색 배경
      tr.innerHTML = `
        <td>${escapeHtml(String(r.no))}</td>
        <td>${escapeHtml(r.time)}</td>
        <td><span style="color:#0e8cc8;font-weight:600">[PEER]</span> ${escapeHtml(r.interfaceName)}</td>
        <td>${escapeHtml(r.srcMac)}</td>
        <td>${escapeHtml(r.dstMac)}</td>
        <td>${escapeHtml(r.source)}</td>
        <td>${escapeHtml(r.destination)}</td>
        <td><strong>${escapeHtml(r.protocol)}</strong></td>
        <td>${r.length}</td>
        <td>${escapeHtml(r.info)}</td>
      `;
      tr.addEventListener('click', () => {
        $('packetDetails').textContent = r.detailText || '(no detail)';
        $('packetHex').textContent = r.hexDump || '';
      });
      tbody.appendChild(tr);
    });
  } catch (err) {
    toast(`Peer 패킷 수신 실패: ${err.message}`, 'bad');
  }
}

function initPeerControls() {
  // topbar Peer URL 복원
  if (peer.url) {
    $('peerUrl').value = peer.url;
    // 서버에도 이전 URL 복원
    api('/api/peer/url', { method: 'POST', body: JSON.stringify({ url: peer.url }) }).catch(() => {});
  }

  $('peerProbe')?.addEventListener('click', probePeer);
  $('peerCaptureStart')?.addEventListener('click', startPeerCapture);
  $('peerCaptureStop')?.addEventListener('click', stopPeerCapture);
  $('peerCaptureFetch')?.addEventListener('click', fetchPeerPackets);
}

init();
