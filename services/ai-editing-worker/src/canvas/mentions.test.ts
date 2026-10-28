import { createScene } from '@macro-inc/graphics';
import {
  plainRichText,
  richTextPlainText,
} from '@macro-inc/lexical-core/canvas-text';
import { getQuickJS } from 'quickjs-emscripten';
import { expect, it } from 'vitest';
import { canvasUserMentions, insertCanvasUserMention } from './mentions';
import { prepareCanvasEdit } from './operations';
import { runCanvasCode } from './sandbox';
import { describeCanvas } from './session';

it('inserts real person chips through QuickJS into text, ellipse labels and empty labels', async () => {
  const operations = runCanvasCode(
    await getQuickJS(),
    `
    const person = {userId:'macro|alice@example.com',email:'alice@example.com',displayName:'Alice'};
    const t=editor.create({type:'text',x:0,y:0,text:'Review with  today'});
    editor.mentionUser(t,12,person);
    const e=editor.create({type:'ellipse',x:400,y:0,text:'Owner: '});
    editor.mentionUser(e,7,person);
    const r=editor.create({type:'rectangle',x:800,y:0});
    editor.mentionUser(r,0,person);
  `
  );
  const document = prepareCanvasEdit(createScene(), operations);
  const scene = JSON.parse(describeCanvas(document));
  expect(scene.items.map((item: { text: string }) => item.text)).toEqual([
    'Review with \uFFFC today',
    'Owner: \uFFFC',
    '\uFFFC',
  ]);
  expect(
    scene.items.map((item: { userMentions: unknown }) => item.userMentions)
  ).toEqual(
    [12, 7, 0].map((at) => [
      {
        userId: 'macro|alice@example.com',
        email: 'alice@example.com',
        displayName: 'Alice',
        at,
      },
    ])
  );
});

it('keeps formatting and existing decorators, and shares read offsets across paragraphs', () => {
  const state = JSON.parse(plainRichText('bold link\nNext'));
  state.root.children[0].children[0].format = 1;
  const person = {
    userId: 'macro|alice@example.com',
    email: 'alice@example.com',
  };
  const first = insertCanvasUserMention(JSON.stringify(state), 5, person);
  const result = insertCanvasUserMention(first, 11, person);
  expect(richTextPlainText(result)).toBe('bold \uFFFClink\n\uFFFCNext');
  expect(canvasUserMentions(result).mentions.map((m) => m.at)).toEqual([5, 11]);
  expect(JSON.parse(result).root.children[0].children).toMatchObject([
    { type: 'text', text: 'bold ', format: 1 },
    { type: 'user-mention' },
    { type: 'text', text: 'link', format: 1 },
  ]);
  expect(() => insertCanvasUserMention(first, 100, person)).toThrow('offset');
  expect(() => insertCanvasUserMention(plainRichText('😀'), 1, person)).toThrow(
    'Unicode'
  );
  expect(
    richTextPlainText(
      insertCanvasUserMention(
        '{"root":{"type":"root","version":1,"children":[]}}',
        0,
        person
      )
    )
  ).toBe('\uFFFC');
});

it('rejects bad person data and late invalid offsets before changing the original scene', async () => {
  const original = prepareCanvasEdit(createScene(), [
    { kind: 'create', id: 'text', type: 'text', x: 0, y: 0, text: 'Hello' },
  ]);
  const saved = JSON.stringify(original);
  const quick = await getQuickJS();
  expect(() =>
    runCanvasCode(
      quick,
      `editor.mentionUser('text',0,{userId:'u',email:'not an email'});`
    )
  ).toThrow();
  const ops = runCanvasCode(
    quick,
    `editor.move(['text'],10,0); editor.mentionUser('text',99,{userId:'macro|alice@example.com',email:'alice@example.com'});`
  );
  expect(() => prepareCanvasEdit(original, ops)).toThrow('offset');
  expect(JSON.stringify(original)).toBe(saved);
});

it('bounds identity metadata from existing imported chips without changing identities', () => {
  const state = JSON.parse(plainRichText());
  state.root.children[0].children = [
    {
      type: 'user-mention',
      version: 1,
      userId: 'macro|alice@example.com',
      email: 'alice@example.com',
      displayName: 'x'.repeat(500_000),
    },
    {
      type: 'user-mention',
      version: 1,
      userId: 'x'.repeat(500_000),
      email: 'alice@example.com',
    },
    {
      type: 'user-mention',
      version: 1,
      userId: 'macro|bob@example.com',
      email: 'bob@example.com',
      displayName: 'Bob',
    },
  ];
  const content = JSON.stringify(state);
  expect(canvasUserMentions(content)).toEqual({
    mentions: [
      {
        userId: 'macro|bob@example.com',
        email: 'bob@example.com',
        displayName: 'Bob',
        at: 2,
      },
    ],
    incomplete: true,
  });
  const scene = prepareCanvasEdit(createScene(), [
    { kind: 'create', id: 'text', type: 'text', x: 0, y: 0 },
  ]);
  const item = scene.items.text;
  if (item.type !== 'text') throw new Error('Missing text');
  const read = JSON.parse(
    describeCanvas({
      ...scene,
      items: {
        ...scene.items,
        text: { ...item, geometry: { ...item.geometry, content } },
      },
    })
  );
  expect(read.items[0].userMentionsTruncated).toBe(true);
  expect(read.items[0].userMentions[0].userId).toBe('macro|bob@example.com');
  expect(JSON.stringify(read).length).toBeLessThan(2000);
  state.root.children[0].children = Array.from({ length: 100 }, () => ({
    type: 'user-mention',
    version: 1,
    userId: 'macro|alice@example.com',
    email: 'alice@example.com',
  }));
  const bounded = canvasUserMentions(JSON.stringify(state));
  expect(bounded.incomplete).toBe(true);
  expect(JSON.stringify(bounded.mentions).length).toBeLessThan(4100);
});
