import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import {
  createEditor as originalEditor,
  $getTextNodeOffset as originalOffset,
  $createTextNode as originalText,
} from 'lexical';
import { initializeConformance } from '../../backend/conformance';
import { $createTextNode, createEditor } from '../../index';
import { $getTextNodeOffset } from '../node-carets';

assert.equal(process.env.NODE_ENV, 'production');
const binary = readFileSync(
  new NodeURL(
    '../../../../lexical-conformance/pkg/web/lexical_conformance_wasm_bg.wasm',
    import.meta.url
  )
);
const pin: { version: string } = JSON.parse(
  readFileSync(
    new NodeURL(
      '../../../../lexical-conformance/upstream.lock',
      import.meta.url
    ),
    'utf8'
  )
);
initializeConformance(new WebAssembly.Module(binary), pin.version);

const original = originalEditor({
  onError(error) {
    throw error;
  },
});
let originalCount = 0;
let originalResult = -1;
const savedWarn = console.warn;
original.update(
  () => {
    const text = originalText('alpha');
    console.warn = () => {
      originalCount++;
    };
    try {
      originalResult = originalOffset(text, 100);
    } finally {
      console.warn = savedWarn;
    }
  },
  { discrete: true }
);

const actual = createEditor({
  onError(error) {
    throw error;
  },
});
let actualCount = 0;
let actualResult = -1;
try {
  actual.update(() => {
    const text = $createTextNode('alpha');
    console.warn = () => {
      actualCount++;
    };
    try {
      actualResult = $getTextNodeOffset(text, 100);
    } finally {
      console.warn = savedWarn;
    }
  });
} finally {
  actual.dispose();
}
assert.equal(originalCount, 1);
assert.equal(actualCount, originalCount);
assert.equal(actualResult, originalResult);
assert.equal(actualResult, 5);
process.stdout.write(
  JSON.stringify({
    originalCount,
    actualCount,
    originalResult,
    actualResult,
    nativeAcceptance: false,
  }) + '\n'
);
