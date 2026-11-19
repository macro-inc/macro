// Post one of each kind of row through the real API (as alice/bob) into #freshness so the
// bulk SQL seed can copy the exact row shapes. Prints the created ids.
const L = require('./lib.cjs');
(async () => {
  const browser = await L.launch();
  const mk = async (email) => { const ctx = await L.newContext(browser, { storageState: await L.authState(browser, email), insecure: true }); return ctx; };
  const alice = await mk('alice@seed.macro.local'); const bob = await mk('bob@seed.macro.local');
  const ch = L.ENV.channels.freshness; const base = `${L.BASE}/dss/messages/channel/${ch}`;
  const j = async (r) => { const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status(), body: b }; };
  const out = {};
  out.plain = await j(await alice.request.post(base, { data: { content: 'Plain API message', nonce: 'n1' } }));
  const root = out.plain.body.id;
  out.mention = await j(await bob.request.post(base, { data: { content: 'Hey <m-user-mention>{"userId":"macro|alice@seed.macro.local","email":"alice@seed.macro.local","displayName":"Alice Quinn"}</m-user-mention> look', mentions: [{ entity_type: 'user', entity_id: 'macro|alice@seed.macro.local' }], nonce: 'n2' } }));
  out.reply = await j(await bob.request.post(base, { data: { content: 'A reply', thread_id: root, nonce: 'n3' } }));
  out.react = await j(await bob.request.post(`${base}/items/${root}/reactions`, { data: { emoji: '👍', add: true, nonce: 'n4' } }));
  out.edit = await j(await alice.request.patch(`${base}/items/${root}`, { data: { content: 'Plain API message (edited)', mentions: [], attachments: { type: 'preserve' }, nonce: 'n5' } }));
  const del = await j(await alice.request.post(base, { data: { content: 'To be deleted', nonce: 'n6' } }));
  out.del = await j(await alice.request.delete(`${base}/items/${del.body.id}?nonce=n7`)); out.delId = del.body.id;
  // attachment: 1x1 png
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = await j(await alice.request.put(`${L.BASE}/static-file/api/file`, { data: { file_name: 'pixel.png', content_type: 'image/png', content_length: png.length } }));
  out.upload = up;
  if (up.body && up.body.upload_url) {
    const put = await alice.request.put(up.body.upload_url, { data: png, headers: { 'content-type': 'image/png' } });
    out.uploadPut = put.status();
    out.attach = await j(await alice.request.post(base, { data: { content: 'With an image', attachments: [{ entity_type: 'static/image', entity_id: up.body.id, width: 800, height: 600 }], nonce: 'n8' } }));
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
