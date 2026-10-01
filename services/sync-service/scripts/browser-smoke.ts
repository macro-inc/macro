import * as A from '@automerge/automerge';
import { AutomergeSession, initializeDocument } from '../client/document';

type Content = { text: string; cells: Record<string, string> };

async function run() {
  const { base: configuredBase, id, token } = await (await fetch('/config')).json();
  const base = new URL(configuredBase, window.location.origin).href.replace(/\/$/, '');
  const seed = A.from<Content>({ text: 'hello 🐺', cells: {} });
  await initializeDocument(`${base}/document/${id}/initialize`, token, seed);
  A.free(seed);
  const peers = ['alice', 'bob'].map(() => new AutomergeSession<Content>({
    url: `${base}/document/${id}/connect`, token: () => token,
  }));
  try {
    const [alice, bob] = peers;
    await Promise.all(peers.map(peer => peer.connect()));
    bob.disconnect();
    bob.change(doc => { A.splice(doc, ['text'], 0, 0, 'offline '); doc.cells.B1 = 'bob'; });
    alice.change(doc => { A.splice(doc, ['text'], 0, 0, 'online '); doc.cells.A1 = 'alice'; });
    await alice.flush();
    await bob.connect();
    await bob.flush();
    const deadline = Date.now() + 10_000;
    while (JSON.stringify(A.getHeads(alice.doc)) !== JSON.stringify(A.getHeads(bob.doc))) {
      if (Date.now() > deadline) throw new Error('Peers did not converge');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!alice.doc.text.includes('online') || !alice.doc.text.includes('offline') ||
      alice.doc.cells.A1 !== 'alice' || alice.doc.cells.B1 !== 'bob') throw new Error('Concurrent edits lost');
    const recovered = new AutomergeSession<Content>({ url: `${base}/document/${id}/connect`, token: () => token });
    peers.push(recovered);
    await recovered.connect();
    if (JSON.stringify(A.getHeads(recovered.doc)) !== JSON.stringify(A.getHeads(alice.doc))) throw new Error('Reload differs');
    return { status: 'passed', id, heads: A.getHeads(alice.doc), document: JSON.parse(JSON.stringify(alice.doc)) };
  } finally {
    peers.forEach(peer => peer.dispose());
  }
}

run().then(result => {
  document.body.textContent = JSON.stringify(result, null, 2);
  document.body.dataset.result = 'passed';
}).catch(error => {
  document.body.textContent = String(error.stack ?? error);
  document.body.dataset.result = 'failed';
});
