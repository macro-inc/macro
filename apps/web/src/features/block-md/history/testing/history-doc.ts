import type { HistorySession } from '@service-sync/client';
import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';
import { sessionize } from '../sessionize';

// The markdown editor's Loro layout: lexical's serialized state, with each
// text node's text in a LoroText and children in movable lists.
export function paragraph(id: string, text: string) {
  const node = new LoroMap();
  node.setContainer('$', new LoroMap()).set('id', id);
  node.set('type', 'paragraph');
  node.set('direction', 'ltr');
  node.set('format', '');
  node.set('indent', 0);
  node.set('version', 1);
  node.set('textFormat', 0);
  node.set('textStyle', '');
  const textNode = node
    .setContainer('children', new LoroMovableList())
    .insertContainer(0, new LoroMap());
  textNode.setContainer('$', new LoroMap()).set('id', `${id}-text`);
  textNode.set('type', 'text');
  textNode.set('detail', 0);
  textNode.set('format', 0);
  textNode.set('mode', 'normal');
  textNode.set('style', '');
  textNode.set('version', 1);
  textNode.setContainer('text', new LoroText()).insert(0, text);
  return node;
}

export function createRoot(doc: LoroDoc, paragraphs: string[]) {
  const root = doc.getMap('root');
  root.set('type', 'root');
  root.set('direction', 'ltr');
  root.set('format', '');
  root.set('indent', 0);
  root.set('version', 1);
  const children = root.setContainer('children', new LoroMovableList());
  paragraphs.forEach((text, i) => {
    children.pushContainer(paragraph(`p${i}`, text));
  });
}

export function blocks(doc: LoroDoc) {
  const children = doc.getMap('root').get('children');
  if (!(children instanceof LoroMovableList)) throw new Error('no children');
  return children;
}

export function textOf(block: unknown): LoroText {
  if (!(block instanceof LoroMap)) throw new Error('not a block');
  const textNode = block.get('children').get(0);
  return textNode.get('text');
}

export function commitAt(doc: LoroDoc, seconds: number) {
  doc.setNextCommitTimestamp(seconds);
  doc.commit();
}

export function sync(target: LoroDoc, ...sources: LoroDoc[]) {
  for (const source of sources) {
    target.import(
      source.export({ mode: 'update', from: target.oplogVersion() })
    );
  }
}

export function sessionsOf(doc: LoroDoc): HistorySession[] {
  const events: { userId: string; tMs: number }[] = [];
  for (const [peer, changes] of doc.getAllChanges()) {
    for (const change of changes) {
      events.push({ userId: peer, tMs: change.timestamp * 1000 });
    }
  }
  return sessionize(events);
}

// Three authors taking turns: each session edits 40 times, mostly typing into a
// random paragraph and sometimes adding one, an hour after the last session.
export function buildLargeDoc(
  sessionCount: number,
  startSeconds = 1_700_000_000
) {
  const authors = [1n, 2n, 3n].map((peer) => {
    const doc = new LoroDoc();
    doc.setPeerId(peer);
    return doc;
  });
  createRoot(
    authors[0],
    Array.from({ length: 40 }, (_, i) => `Paragraph ${i}`)
  );
  commitAt(authors[0], startSeconds);
  let seconds = startSeconds + 100;
  let seed = 1;
  const random = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed % n;
  };
  for (let s = 0; s < sessionCount; s++) {
    const author = authors[s % authors.length];
    sync(author, ...authors.filter((other) => other !== author));
    const list = blocks(author);
    for (let edit = 0; edit < 40; edit++) {
      if (random(10) === 0) {
        list.insertContainer(
          random(list.length + 1),
          paragraph(`s${s}-${edit}`, 'A new paragraph')
        );
      } else {
        const text = textOf(list.get(random(list.length)));
        text.insert(random(text.length + 1), 'word ');
      }
      commitAt(author, seconds);
      seconds += 20;
    }
    seconds += 3600;
  }
  const doc = new LoroDoc();
  sync(doc, ...authors);
  return doc;
}
