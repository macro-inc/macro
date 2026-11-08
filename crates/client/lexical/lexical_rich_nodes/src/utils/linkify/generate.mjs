// Regenerate the pinned expanded regex sources and deterministic oracle corpus.
// Usage: node generate.mjs /path/to/linkify-it/index.mjs (5.0.2, uc.micro 2.1.0)
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const moduleUrl = pathToFileURL(process.argv[2]);
const {default: LinkifyIt} = await import(moduleUrl);
const version = JSON.parse(fs.readFileSync(new URL('package.json', moduleUrl))).version;
if (version !== '5.0.2') throw new Error('linkify-it must be 5.0.2');
const ucPackage=createRequire(moduleUrl).resolve('uc.micro/package.json');
const ucVersion=JSON.parse(fs.readFileSync(ucPackage)).version;
if (ucVersion !== '2.1.0') throw new Error('uc.micro must be 2.1.0');
const patterns = {};
const source = fs.readFileSync(moduleUrl, 'utf8');
patterns.__tlds_2ch = source.match(/const tlds_2ch_src_re = '([^']+)'/)[1];
patterns.__tlds_default = 'biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф';
for (const [key, value] of Object.entries(new LinkifyIt().re)) {
  patterns[key] = value instanceof RegExp ? value.source : value;
}
const dashes = new LinkifyIt({}, {'---': true});
for (const [key, value] of Object.entries(dashes.re)) {
  patterns[key + '_dashes'] = value instanceof RegExp ? value.source : value;
}
fs.writeFileSync(new URL('patterns.json', import.meta.url), JSON.stringify(patterns, null, 2) + '\n');
const inputs = ['', '😀 example.com', '😀https://example.com/a', 'http://user@example.com',
  'https://example.com/a_(b)?q=x#ok', 'user@example.com', 'ftp://127.0.0.1:65535/a',
  '//example.com', 'x://example.com', '///example.com', 'mailto:user@example.com',
  'user@example.com/path', 'тест.рф', 'HTTP://example.com', 'www.example.com---x',
  'example.com,example.org', '192.168.1.1@example.com', 'a.com@example.org'];
let seed = 0x170045;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const prefixes = ['', ' ', '😀 ', '(', '<', '_', ':', 'x/', '文', '\n', 'http:', 'mailto:'];
const hosts = ['example.com', 'example.org', 'localhost', '127.0.0.1', 'example.invalid',
  'xn--e1afmkfd.xn--p1ai', 'тест.рф', '例子.com', 'a.co', 'a.ab', 'www.example.com'];
const schemes = ['', 'http://', 'https://', 'ftp://', '//', 'mailto:user@', 'user@'];
const paths = ['', '/', '/a', '/a_(b)', ':65535/path', ':65536/', '?q=x', '/a...b', '/😀', '/a---b', '/a,b;', '.foo', '...'];
const suffixes = ['', ' ', ')', '>', '.', ',', '!', '\n', ' example.org', ' user@example.com'];
for (let i=0;i<5000;i++) {
  const prefix=prefixes[next()%prefixes.length];
  const scheme=schemes[next()%schemes.length];
  let host=hosts[next()%hosts.length];
  let path=paths[next()%paths.length];
  const suffix=suffixes[next()%suffixes.length];
  // Synthetic email examples use reserved domains; retain other hosts for URL recognition.
  if (scheme.includes('@') && !['example.com','example.org','example.invalid','localhost'].includes(host)) host='sub.example.com';
  if (scheme.includes('@') && path === '.foo') path='.test';
  inputs.push(prefix+scheme+host+path+suffix);
}
const corpus = inputs.map((text,index) => {
  const options = {fuzzyLink: index % 7 !== 0, fuzzyEmail: index % 11 !== 0, fuzzyIP: index % 3 === 0, '---': index % 5 === 0};
  const linkify = new LinkifyIt(options);
  const tlds = index % 13 === 0 ? ['invalid'] : null;
  const keep = index % 2 === 0;
  if (tlds) linkify.tlds(tlds, keep);
  return {text, options, tlds, keep, test:linkify.test(text), pretest:linkify.pretest(text), matches:linkify.match(text) ?? [], atStart:linkify.matchAtStart(text)};
});
fs.writeFileSync(new URL('corpus.json', import.meta.url), JSON.stringify(corpus) + '\n');
