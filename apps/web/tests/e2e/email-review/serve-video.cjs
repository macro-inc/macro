// Run with Bun. Only publish the video and synthetic evidence, never auth state.
const path = require('node:path');
const fs = require('node:fs');
const output =
  process.env.EMAIL_REVIEW_OUTPUT || '/tmp/email-exhaustive-review';
const allowed = new Set([
  'index.html',
  'email-verification.mp4',
  'EMAIL_LOCAL_VERIFICATION.md',
  'results.json',
  'cleanup-audit.json',
  'database-after.log',
  'chapters.json',
]);
const auditPath = path.join(output, 'cleanup-audit.json');
if (fs.existsSync(auditPath))
  allowed.add(JSON.parse(fs.readFileSync(auditPath)).rawResults);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.EMAIL_REVIEW_VIDEO_PORT || 24891),
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405 });
    const name = new URL(request.url).pathname.slice(1) || 'index.html';
    if (!allowed.has(name) && !/^artifacts\/[a-z0-9-]+\.png$/i.test(name))
      return new Response(null, { status: 404 });
    const file = Bun.file(path.join(output, name));
    if (!(await file.exists())) return new Response(null, { status: 404 });
    return new Response(file);
  },
});
console.log(`Email verification player: http://localhost:${server.port}`);
