import { readFileSync, writeFileSync } from 'node:fs';
const f = 'offline.spec.ts';
let t = readFileSync(f, 'utf8');
const a = t.indexOf("test('OFF-13");
const b = t.indexOf('// If this fails, a person cannot go back to an old message');
let body = t.slice(a, b);
body = body
  .replace("  page,\n  ada,\n  ben,\n}) => {", "  pageFor,\n  dee,\n}) => {")
  .replace("  test.setTimeout(240_000);\n", "  test.setTimeout(240_000);\n  // Dee's, so that the other tests' people keep under a hundred channels.\n  const page = await pageFor('dee');\n")
  .replaceAll('ada.createChannel({ members: [ben.person] })', 'dee.createChannel({})')
  .replaceAll('ada.post(', 'dee.post(');
if (body.includes('ada') || body.includes('ben.')) throw new Error('left over');
writeFileSync(f, t.slice(0, a) + body + t.slice(b));
