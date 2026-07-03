// SharedWorker probe target. Tests:
//  1. capabilities inside the SharedWorker context itself (sync access
//     handles are expected to be UNAVAILABLE here per spec),
//  2. the leader topology the design depends on: spawning a *nested*
//     dedicated worker from inside the SharedWorker and running the full
//     probe/bench suite there.

'use strict';

importScripts('./probe-lib.js');

let nested = null;
let nestedSeq = 0;
const nestedPending = new Map();

function getNestedWorker() {
  if (nested) return nested;
  nested = new Worker('./dedicated-worker.js');
  nested.onmessage = (e) => {
    const p = nestedPending.get(e.data.id);
    if (p) {
      nestedPending.delete(e.data.id);
      p.resolve(e.data);
    }
  };
  nested.onerror = (e) => {
    for (const p of nestedPending.values()) p.reject(new Error(`nested worker error: ${e.message}`));
    nestedPending.clear();
  };
  return nested;
}

function callNested(msg, timeoutMs) {
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = getNestedWorker();
    } catch (e) {
      reject(e);
      return;
    }
    const id = `n${++nestedSeq}`;
    nestedPending.set(id, { resolve, reject });
    setTimeout(() => {
      if (nestedPending.delete(id)) reject(new Error(`nested call timeout: ${msg.type}`));
    }, timeoutMs || 15000);
    w.postMessage({ ...msg, id });
  });
}

async function handle(msg) {
  switch (msg.type) {
    case 'caps':
      return { type: 'caps', caps: await runCaps() };
    case 'nested-caps': {
      const res = await callNested({ type: 'caps' }, 5000);
      if (!res.ok) throw new Error(res.error);
      return { type: 'nested-caps', caps: res.caps };
    }
    case 'nested-bench-opfs': {
      const res = await callNested({ type: 'bench-opfs', opCount: msg.opCount }, 60000);
      if (!res.ok) throw new Error(res.error);
      return { type: 'nested-bench-opfs', result: res.result };
    }
    case 'echo':
      return { type: 'echo', payload: msg.payload };
    default:
      throw new Error(`unknown message type: ${msg.type}`);
  }
}

self.onconnect = (e) => {
  const port = e.ports[0];
  port.onmessage = async (ev) => {
    const { id } = ev.data;
    try {
      const res = await handle(ev.data);
      port.postMessage({ id, ok: true, ...res });
    } catch (err) {
      port.postMessage({ id, ok: false, error: String(err) });
    }
  };
  port.start();
};
