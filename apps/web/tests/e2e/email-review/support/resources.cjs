// Run from the repository root inside nix develop, after applying the seed and login.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const output =
  process.env.EMAIL_REVIEW_OUTPUT || '/tmp/email-exhaustive-review';
const api = process.env.EMAIL_REVIEW_API || 'http://localhost:24709';
const storage = 'http://localhost:24706';
if (!['localhost', '127.0.0.1'].includes(new URL(api).hostname))
  throw new Error('Local seed only');
const manifestPath = path.join(output, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const auth = JSON.parse(fs.readFileSync(path.join(output, 'alex-auth.json')));
const headers = {
  cookie: auth.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  'content-type': 'application/json',
};
const sql = (value) => "'" + String(value).replaceAll("'", "''") + "'";
async function request(route, method = 'GET', body) {
  const response = await fetch(api + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}
async function upload(url, bytes, contentType) {
  const local = new URL(url);
  local.hostname = 'localhost';
  local.port = '24706';
  const response = await fetch(local, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': contentType },
  });
  if (!response.ok) throw new Error(`Local upload failed: ${response.status}`);
}
(async () => {
  const statements = ['BEGIN;'];
  manifest.attachmentDocuments ||= {};
  for (const [name, id] of Object.entries(manifest.attachments)) {
    const bytes = fs.readFileSync(path.join(output, 'assets', name));
    const mime = name.endsWith('.png')
      ? 'image/png'
      : name.endsWith('.ics')
        ? 'text/calendar'
        : 'text/plain';
    await upload(
      `${storage}/macro-email-attachments/temp/${manifest.links.work}/${id}-${name}`,
      bytes,
      mime
    );
    if (!manifest.attachmentDocuments[name]) {
      const response = await request('/dss/documents', 'POST', {
        documentName: path.parse(name).name,
        fileType: path.extname(name).slice(1),
        sha: crypto.createHash('sha256').update(bytes).digest('hex'),
      });
      const data = response.data;
      await upload(data.presignedUrl, bytes, data.contentType);
      manifest.attachmentDocuments[name] = data.documentMetadata.documentId;
    }
    statements.push(
      `DELETE FROM document_email WHERE email_attachment_id=${sql(id)} AND document_id<>${sql(manifest.attachmentDocuments[name])};`
    );
    statements.push(
      `INSERT INTO document_email(document_id,email_attachment_id) VALUES (${sql(manifest.attachmentDocuments[name])},${sql(id)}) ON CONFLICT DO NOTHING;`
    );
    statements.push(
      `UPDATE email_attachments SET size_bytes=${bytes.length} WHERE id=${sql(id)};`
    );
  }
  if (!manifest.sfsImageId) {
    const image = await request('/static-file/api/file', 'PUT', {
      file_name: 'atlas-mark.png',
      content_type: 'image/png',
    });
    await upload(
      image.upload_url,
      fs.readFileSync(path.join(output, 'assets', 'atlas-mark.png')),
      'image/png'
    );
    manifest.sfsImageId = image.id;
  }
  statements.push(
    `INSERT INTO email_attachments_sfs(id,attachment_id,sfs_id) SELECT gen_random_uuid(),${sql(manifest.attachments['atlas-mark.png'])},${sql(manifest.sfsImageId)} WHERE NOT EXISTS(SELECT 1 FROM email_attachments_sfs WHERE attachment_id=${sql(manifest.attachments['atlas-mark.png'])});`
  );
  if (!manifest.aiChat) {
    const chat = await request('/cognition/chats', 'POST', {
      name: 'Atlas — AI email review',
    });
    manifest.aiChat = chat.id || chat.chat_id;
    manifest.aiMessage = crypto.randomUUID();
    if (!manifest.aiChat) throw new Error('Chat creation did not return an ID');
  }
  const parts = [
    { type: 'text', text: 'Please review this draft before sending.' },
    {
      type: 'toolCall',
      name: 'SendEmail',
      id: 'review-send-email',
      json: {
        subject: 'Atlas AI follow-up',
        body: 'Hi Maya,\n\nPlease review the **launch agenda**.',
        to: [{ email: manifest.users.maya.email, name: 'Maya Chen' }],
        cc: [{ email: 'noah@northstar.test', name: 'Noah Patel' }],
        bcc: [],
      },
    },
    {
      type: 'toolCallResponseJson',
      name: 'SendEmail',
      id: 'review-send-email',
      json: 'PendingUserExecution',
    },
  ];
  statements.push(
    `INSERT INTO "ChatMessage"(id,"chatId",role,content) VALUES (${sql(manifest.aiMessage)},${sql(manifest.aiChat)},'assistant',${sql(JSON.stringify(parts))}::jsonb) ON CONFLICT (id) DO UPDATE SET content=excluded.content;`
  );
  manifest.notificationId ||= crypto.randomUUID();
  const notificationMetadata = {
    sender: 'Noah Patel',
    toEmail: manifest.users.alex.email,
    threadId: manifest.threads['work:plain'],
    subject: 'Plaintext checklist — release readiness',
    snippet: 'Review accessibility and confirm the launch date.',
  };
  statements.push(
    `INSERT INTO notification(id,notification_event_type,event_item_id,event_item_type,service_sender,metadata,sender_id) VALUES (${sql(manifest.notificationId)},'new_email',${sql(manifest.threads['work:plain'])},'email_thread','email_review',${sql(JSON.stringify(notificationMetadata))}::jsonb,NULL) ON CONFLICT DO NOTHING;`
  );
  statements.push(
    `INSERT INTO user_notification(user_id,notification_id,sent,is_important_v0) VALUES (${sql('macro|' + manifest.users.alex.email)},${sql(manifest.notificationId)},true,true) ON CONFLICT (user_id,notification_id) DO UPDATE SET done=false,deleted_at=NULL;`
  );
  statements.push('COMMIT;');
  execFileSync(
    'psql',
    [
      'postgres://user:password@localhost:24700/macrodb',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: statements.join('\n'), stdio: ['pipe', 'ignore', 'inherit'] }
  );
  for (const id of Object.values(manifest.documents))
    await request('/dss/history/document/' + id, 'POST');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    'Prepared real attachment storage, document mappings, history and pending AI tool output.'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
