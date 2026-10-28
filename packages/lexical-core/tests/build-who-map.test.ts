import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { buildWhoMap } from '../utils/buildWhoMap';

describe('buildWhoMap', () => {
  it('maps only the blocks edited after `since`', () => {
    const alice = new LoroDoc();
    alice.setPeerId(1n);
    const children = alice
      .getMap('root')
      .setContainer('children', new LoroMovableList());
    const texts: LoroText[] = [];
    for (const id of ['first', 'second']) {
      const block = children.pushContainer(new LoroMap());
      block.setContainer('$', new LoroMap()).set('id', id);
      block.set('type', 'paragraph');
      const textNode = block
        .setContainer('children', new LoroMovableList())
        .pushContainer(new LoroMap());
      textNode.setContainer('$', new LoroMap()).set('id', `${id}-text`);
      textNode.set('type', 'text');
      const text = textNode.setContainer('text', new LoroText());
      text.insert(0, id);
      texts.push(text);
    }
    alice.commit();
    const since = alice.oplogVersion();

    const bob = new LoroDoc();
    bob.setPeerId(2n);
    bob.import(alice.export({ mode: 'snapshot' }));
    const secondText = bob.getContainerById(texts[1].id);
    if (!(secondText instanceof LoroText)) throw new Error('no text');
    secondText.insert(6, ' edited');
    bob.commit();

    const peerToUser = (peer: string) => (peer === '1' ? 'alice' : 'bob');
    expect(buildWhoMap(bob, peerToUser)).toEqual(
      new Map([
        ['first', 'alice'],
        ['second', 'bob'],
      ])
    );
    expect(buildWhoMap(bob, peerToUser, since)).toEqual(
      new Map([['second', 'bob']])
    );
  });
});
