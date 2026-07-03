// Main-thread orchestrator: runs capability probes in every context
// (window, dedicated worker, SharedWorker, nested worker inside the
// SharedWorker) plus storage/RPC benchmarks, then renders a support matrix
// and a copy-pastable markdown report.

const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const markdownEl = document.getElementById('markdown');
const runBtn = document.getElementById('run');
const copyBtn = document.getElementById('copy');

function setStatus(text) {
  statusEl.textContent = text;
}

// --- generic RPC over a Worker or MessagePort ------------------------------

function makeRpc(target /* Worker | MessagePort */) {
  let seq = 0;
  const pending = new Map();
  const onMessage = (e) => {
    const p = pending.get(e.data.id);
    if (p) {
      pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
    }
  };
  target.onmessage = onMessage;
  if (target.start) target.start();
  return (msg, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = `m${++seq}`;
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout: ${msg.type}`));
      }, timeoutMs);
      target.postMessage({ ...msg, id });
    });
}

// --- window-context probes (mirrors probe-lib, main-thread flavor) ---------

async function windowCaps() {
  const caps = {
    sharedWorkerCtor: {
      supported: typeof SharedWorker === 'function',
      detail: null,
    },
    opfsRoot: { supported: false, detail: null },
    syncAccessHandle: {
      supported: false,
      detail: 'not expected on main thread',
    },
    webLocks: { supported: 'locks' in navigator, detail: null },
    broadcastChannel: {
      supported: typeof BroadcastChannel === 'function',
      detail: null,
    },
    storagePersist: { supported: false, detail: null },
    storageEstimate: { supported: false, detail: null },
  };
  try {
    if (navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      caps.opfsRoot.supported = !!root;
      if (root) {
        const f = await root.getFileHandle('__probe_main.bin', {
          create: true,
        });
        caps.syncAccessHandle.supported =
          typeof f.createSyncAccessHandle === 'function';
        caps.syncAccessHandle.detail = caps.syncAccessHandle.supported
          ? 'method exists on main thread (calling it may still throw)'
          : 'method absent on main thread (expected)';
        await root.removeEntry('__probe_main.bin').catch(() => {});
      }
    } else {
      caps.opfsRoot.detail = 'navigator.storage.getDirectory missing';
    }
  } catch (e) {
    caps.opfsRoot.detail = String(e);
  }
  try {
    if (navigator.storage?.persist) {
      // NOTE: may show a prompt in Firefox; result "false" ≠ unsupported.
      const persisted = await navigator.storage.persisted();
      caps.storagePersist.supported = true;
      caps.storagePersist.detail = `persisted=${persisted}`;
    }
  } catch (e) {
    caps.storagePersist.detail = String(e);
  }
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      caps.storageEstimate.supported = true;
      caps.storageEstimate.detail = `quota≈${Math.round((est.quota ?? 0) / 1e6)}MB`;
    }
  } catch (e) {
    caps.storageEstimate.detail = String(e);
  }
  return caps;
}

// --- RTT benchmark ----------------------------------------------------------

async function benchRtt(rpc, label) {
  const runs = async (payload, n) => {
    const samples = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await rpc({ type: 'echo', payload });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return {
      avgMs: +avg.toFixed(3),
      p50Ms: +samples[Math.floor(samples.length / 2)].toFixed(3),
      p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
    };
  };
  const tiny = await runs('ping', 100);
  const big = await runs(new ArrayBuffer(64 * 1024), 100);
  return { label, tinyRtt: tiny, clone64kRtt: big };
}

// --- orchestration ----------------------------------------------------------

async function runAll() {
  const report = {
    userAgent: navigator.userAgent,
    date: new Date().toISOString(),
    contexts: {},
    benches: {},
    errors: [],
  };

  setStatus('probing window context…');
  report.contexts.window = await windowCaps();

  // Dedicated worker
  setStatus('probing dedicated worker…');
  let dedicatedRpc = null;
  try {
    const w = new Worker('./dedicated-worker.js');
    dedicatedRpc = makeRpc(w);
    report.contexts.dedicated = (await dedicatedRpc({ type: 'caps' })).caps;
  } catch (e) {
    report.errors.push(`dedicated worker: ${e}`);
  }

  // SharedWorker + nested worker inside it
  let sharedRpc = null;
  if (typeof SharedWorker === 'function') {
    setStatus('probing SharedWorker…');
    try {
      const sw = new SharedWorker('./shared-worker.js');
      sharedRpc = makeRpc(sw.port);
      report.contexts.shared = (await sharedRpc({ type: 'caps' })).caps;
    } catch (e) {
      report.errors.push(`SharedWorker: ${e}`);
    }
    if (sharedRpc) {
      setStatus('probing nested worker inside SharedWorker…');
      try {
        report.contexts.nestedInShared = (
          await sharedRpc({ type: 'nested-caps' })
        ).caps;
      } catch (e) {
        report.errors.push(`nested worker in SharedWorker: ${e}`);
        report.contexts.nestedInShared = null;
      }
    }
  } else {
    report.errors.push('SharedWorker constructor unavailable');
  }

  // Benchmarks
  if (dedicatedRpc) {
    setStatus('benchmark: OPFS sync handle (dedicated worker)…');
    try {
      report.benches.opfsDedicated = (
        await dedicatedRpc({ type: 'bench-opfs', opCount: 1000 }, 60000)
      ).result;
    } catch (e) {
      report.errors.push(`bench opfs (dedicated): ${e}`);
    }
    setStatus('benchmark: IndexedDB (dedicated worker)…');
    try {
      report.benches.idbDedicated = (
        await dedicatedRpc({ type: 'bench-idb', recordCount: 1000 }, 120000)
      ).result;
    } catch (e) {
      report.errors.push(`bench idb (dedicated): ${e}`);
    }
    setStatus('benchmark: RTT to dedicated worker…');
    report.benches.rttDedicated = await benchRtt(
      dedicatedRpc,
      'window ↔ dedicated'
    );
  }
  if (sharedRpc) {
    setStatus('benchmark: RTT to SharedWorker…');
    report.benches.rttShared = await benchRtt(sharedRpc, 'window ↔ shared');
    if (report.contexts.nestedInShared?.syncAccessHandle?.supported) {
      setStatus('benchmark: OPFS via nested worker in SharedWorker…');
      try {
        report.benches.opfsNested = (
          await sharedRpc({ type: 'nested-bench-opfs', opCount: 1000 }, 60000)
        ).result;
      } catch (e) {
        report.errors.push(`bench opfs (nested): ${e}`);
      }
    }
  }

  setStatus('done');
  return report;
}

// --- rendering ---------------------------------------------------------------

const CAP_ROWS = [
  ['sharedWorkerCtor', 'SharedWorker constructor'],
  ['workerCtor', 'Worker constructor (nested spawn)'],
  ['opfsRoot', 'OPFS root (getDirectory)'],
  ['syncAccessHandle', 'createSyncAccessHandle (working)'],
  ['webLocks', 'Web Locks'],
  ['broadcastChannel', 'BroadcastChannel'],
  ['storagePersist', 'storage.persist()'],
  ['storageEstimate', 'storage.estimate()'],
];

const CONTEXTS = [
  ['window', 'Window'],
  ['dedicated', 'Dedicated worker'],
  ['shared', 'SharedWorker'],
  ['nestedInShared', 'Nested worker in SharedWorker'],
];

function cell(cap) {
  if (cap === undefined || cap === null) return { text: '—', cls: '' };
  return {
    text: (cap.supported ? '✅' : '❌') + (cap.detail ? ` ${cap.detail}` : ''),
    cls: cap.supported ? 'yes' : 'no',
  };
}

function renderHtml(report) {
  let html = '<h2>Capabilities</h2><table><tr><th>Capability</th>';
  for (const [, label] of CONTEXTS) html += `<th>${label}</th>`;
  html += '</tr>';
  for (const [key, label] of CAP_ROWS) {
    html += `<tr><td>${label}</td>`;
    for (const [ctx] of CONTEXTS) {
      const c = cell(report.contexts[ctx]?.[key]);
      const detail = c.text.includes(' ')
        ? c.text.slice(c.text.indexOf(' ') + 1)
        : '';
      html += `<td class="${c.cls}">${c.text.split(' ')[0]}${detail ? `<span class="detail">${detail}</span>` : ''}</td>`;
    }
    html += '</tr>';
  }
  html +=
    '</table><h2>Benchmarks</h2><pre>' +
    JSON.stringify(report.benches, null, 2) +
    '</pre>';
  if (report.errors.length) {
    html += '<h2>Errors</h2><pre>' + report.errors.join('\n') + '</pre>';
  }
  resultsEl.innerHTML = html;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`### Probe results — ${report.date}`);
  lines.push('');
  lines.push(`UA: \`${report.userAgent}\``);
  lines.push('');
  lines.push(`| Capability | ${CONTEXTS.map(([, l]) => l).join(' | ')} |`);
  lines.push(`|---|${CONTEXTS.map(() => '---').join('|')}|`);
  for (const [key, label] of CAP_ROWS) {
    const cells = CONTEXTS.map(([ctx]) => {
      const cap = report.contexts[ctx]?.[key];
      if (cap === undefined || cap === null) return '—';
      return cap.supported ? '✅' : `❌${cap.detail ? ` (${cap.detail})` : ''}`;
    });
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.benches, null, 2));
  lines.push('```');
  if (report.errors.length) {
    lines.push('', 'Errors:', ...report.errors.map((e) => `- ${e}`));
  }
  return lines.join('\n');
}

runBtn.onclick = async () => {
  runBtn.disabled = true;
  copyBtn.disabled = true;
  try {
    const report = await runAll();
    renderHtml(report);
    markdownEl.textContent = renderMarkdown(report);
    markdownEl.hidden = false;
    copyBtn.disabled = false;
  } catch (e) {
    setStatus(`failed: ${e}`);
  } finally {
    runBtn.disabled = false;
  }
};

copyBtn.onclick = async () => {
  await navigator.clipboard.writeText(markdownEl.textContent);
  setStatus('markdown copied');
};
