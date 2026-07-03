// Dedicated worker probe target. Also used as the *nested* worker spawned
// from inside the SharedWorker (same protocol over a MessagePort).

'use strict';

importScripts('./probe-lib.js');

async function handle(msg) {
  switch (msg.type) {
    case 'caps':
      return { type: 'caps', caps: await runCaps() };
    case 'bench-opfs':
      return { type: 'bench-opfs', result: await benchOpfsSync(msg.opCount) };
    case 'bench-idb':
      return { type: 'bench-idb', result: await benchIdb(msg.recordCount) };
    case 'echo':
      // Round-trip latency probe; payload is structured-cloned back.
      return { type: 'echo', payload: msg.payload };
    default:
      throw new Error(`unknown message type: ${msg.type}`);
  }
}

function attach(port) {
  port.onmessage = async (e) => {
    const { id } = e.data;
    try {
      const res = await handle(e.data);
      port.postMessage({ id, ok: true, ...res });
    } catch (err) {
      port.postMessage({ id, ok: false, error: String(err) });
    }
  };
}

attach(self);
