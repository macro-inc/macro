// Real Loro operations and binary updates; the Rust test projects them through sync_server_core.
import { mock, setSystemTime } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
await import(root + 'services/lexical-service/src/polyfills/prism.ts');
const { isCommentOnlyChange, contentWithoutComments } = await import(
  root + 'services/lexical-service/src/lib/comment-only-change.ts'
);
const { rawMarkdownStateToLoroSnapshot } = await import(
  root + 'packages/lexical-core/markdown-loro-snapshot.ts'
);
const { LoroDoc, LoroList, LoroMap, LoroMovableList, LoroText } = await import(
  'loro-crdt'
);
const seed = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        $: { id: 'p' },
        children: [
          {
            type: 'text',
            version: 1,
            text: 'hello',
            format: 0,
            style: '',
            mode: 'normal',
            detail: 0,
            $: { id: 'text' },
          },
        ],
      },
    ],
  },
};
const snapshot = await rawMarkdownStateToLoroSnapshot(seed);
if (!snapshot) throw new Error('missing Loro seed');
let rng = 0x18deca73;
function random() {
  rng ^= rng << 13;
  rng ^= rng >>> 17;
  rng ^= rng << 5;
  return rng >>> 0;
}
const rows = [];
for (let index = 0; index < 2048; index++) {
  const doc = new LoroDoc();
  doc.import(snapshot);
  const before = doc.toJSON();
  const vv = doc.oplogVersion();
  const rootMap = doc.getMap('root');
  const rootChildren = rootMap.get('children');
  if (
    !(
      rootChildren instanceof LoroList ||
      rootChildren instanceof LoroMovableList
    )
  )
    throw new Error('Seed root children are not a Loro list');
  const p = rootChildren.get(0);
  if (!(p instanceof LoroMap))
    throw new Error('Seed paragraph is not a Loro map');
  const children = p.get('children');
  if (!(children instanceof LoroMovableList))
    throw new Error('Seed paragraph children are not a Loro movable list');
  const text = children.get(0);
  if (!(text instanceof LoroMap))
    throw new Error('Seed text is not a Loro map');
  const content = text.get('text');
  if (!(content instanceof LoroText))
    throw new Error('Seed content is not Loro text');
  const state = text.get('$');
  if (!(state instanceof LoroMap))
    throw new Error('Seed text state is not a Loro map');
  switch (index % 10) {
    case 0:
      content.insert(random() % 6, '!');
      break;
    case 1:
      content.delete(random() % 5, 1);
      break;
    case 2:
      state.set('id', `new-${random()}`);
      break;
    case 3:
      state.set('peerId', `peer-${random()}`);
      break;
    case 4:
      state.set('retained', random() % 8);
      break;
    case 5:
      text.set('format', random() % 128);
      break;
    case 6:
      text.set('style', 'color: red');
      break;
    case 7:
      p.set('format', random() % 2 ? 'right' : 'center');
      break;
    case 8:
      state.set('local', Boolean(random() % 2));
      break;
    case 9:
      children.set(0, {
        type: 'comment-mark',
        version: 1,
        ids: ['mark'],
        isDraft: false,
        children: [before.root.children[0].children[0]],
      });
      break;
  }
  doc.commit();
  const after = doc.toJSON();
  let expected:
    | {
        commentOnly: boolean;
        before: ReturnType<typeof contentWithoutComments>;
        after: ReturnType<typeof contentWithoutComments>;
      }
    | { throws: true };
  try {
    expected = {
      commentOnly: isCommentOnlyChange(before, after),
      before: contentWithoutComments(before),
      after: contentWithoutComments(after),
    };
  } catch {
    expected = { throws: true };
  }
  rows.push(
    JSON.stringify({
      index,
      before,
      after,
      expected,
      snapshot: Buffer.from(snapshot).toString('base64'),
      update: Buffer.from(doc.export({ mode: 'update', from: vv })).toString(
        'base64'
      ),
    })
  );
}
writeFileSync(process.argv[2], rows.join('\n') + '\n');
console.log(`Generated ${rows.length} real Loro operation pairs`);
