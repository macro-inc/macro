import { $setId, type NodeIdMappings } from '@macro-inc/lexical-core';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GO_TO_LOCATION_COMMAND,
  GO_TO_NODE_ID_COMMAND,
  locationPlugin,
  parsePersistentLocation,
  serializePersistentLocation,
} from '../plugins/location/locationPlugin';
import { behaviorEditor } from './editor';

afterEach(() => vi.useRealTimers());

describe('persistent location encoding', () => {
  it.each([
    {
      input: 'anchor.0.5',
      anchor: 'anchor',
      focus: 'anchor',
      start: 0,
      end: 5,
    },
    {
      input: 'anchor.2,focus.8',
      anchor: 'anchor',
      focus: 'focus',
      start: 2,
      end: 8,
    },
    {
      input: 'anchor.5.0',
      anchor: 'anchor',
      focus: 'anchor',
      start: 5,
      end: 0,
    },
  ])(
    'decodes and serializes $input',
    ({ input, anchor, focus, start, end }) => {
      const value = {
        type: 'persistent' as const,
        anchor: { id: anchor, offset: start },
        focus: { id: focus, offset: end },
      };
      expect(parsePersistentLocation(input)).toEqual(value);
      expect(serializePersistentLocation(value)).toBe(input);
    }
  );

  it.each([
    '',
    'anchor',
    'anchor.0',
    'anchor..5',
    '.0.5',
    'anchor.x.5',
    'anchor.0,focus.x',
    'anchor.0,.1',
  ])('rejects incomplete location %j', (input) => {
    expect(parsePersistentLocation(input)).toBeNull();
  });
});

describe('stable node location navigation', () => {
  it.each([false, true])(
    'finds a live stable ID with stale cached key=%s',
    (stale) => {
      vi.useFakeTimers();
      const mapping: NodeIdMappings = {
        idToNodeKeyMap: new Map(),
        nodeKeyToIdMap: new Map(),
      };
      if (stale) mapping.idToNodeKeyMap.set('fixture-node', 'retired-key');
      const { editor } = behaviorEditor(locationPlugin({ mapping }));
      let key = '';
      editor.update(
        () => {
          const paragraph = $createParagraphNode().append(
            $createTextNode('target')
          );
          key = paragraph.getKey();
          $setId(paragraph, 'fixture-node');
          $getRoot().append(paragraph);
        },
        { discrete: true }
      );
      const element = editor.getElementByKey(key);
      if (!element) throw new Error('Expected target DOM');
      const scroll = vi.fn();
      element.scrollIntoView = scroll;
      expect(
        editor.dispatchCommand(GO_TO_NODE_ID_COMMAND, 'fixture-node')
      ).toBe(true);
      expect(scroll).toHaveBeenCalledExactlyOnceWith({
        behavior: 'smooth',
        block: 'center',
      });
      expect(element.classList.contains('highlighted')).toBe(true);
      expect(mapping.idToNodeKeyMap.get('fixture-node')).toBe(key);
      expect(mapping.nodeKeyToIdMap.get(key)).toBe('fixture-node');
      vi.advanceTimersByTime(2000);
      expect(element.classList.contains('highlighted')).toBe(false);
    }
  );

  it('rejects an unknown stable ID without scrolling', () => {
    const mapping: NodeIdMappings = {
      idToNodeKeyMap: new Map(),
      nodeKeyToIdMap: new Map(),
    };
    const { editor } = behaviorEditor(locationPlugin({ mapping }));
    editor.update(() => $getRoot().append($createParagraphNode()), {
      discrete: true,
    });
    expect(editor.dispatchCommand(GO_TO_NODE_ID_COMMAND, 'missing-node')).toBe(
      false
    );
  });

  it('publishes a range location then revokes it after its configured timeout', () => {
    vi.useFakeTimers();
    const mapping: NodeIdMappings = {
      idToNodeKeyMap: new Map(),
      nodeKeyToIdMap: new Map(),
    };
    const goto = vi.fn();
    const revoke = vi.fn();
    const { editor } = behaviorEditor(
      locationPlugin({
        mapping,
        onGotoLocation: goto,
        revokeOptions: { onRevokeLocation: revoke, timeout: () => 250 },
      })
    );
    let key = '';
    editor.update(
      () => {
        const paragraph = $createParagraphNode().append(
          $createTextNode('target')
        );
        key = paragraph.getKey();
        $setId(paragraph, 'fixture-node');
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    const element = editor.getElementByKey(key);
    if (!element) throw new Error('Expected target DOM');
    element.scrollIntoView = vi.fn();
    const location = {
      type: 'persistent' as const,
      anchor: { id: 'fixture-node', offset: 0 },
      focus: { id: 'fixture-node', offset: 4 },
    };
    expect(editor.dispatchCommand(GO_TO_LOCATION_COMMAND, location)).toBe(true);
    expect(goto).toHaveBeenCalledExactlyOnceWith(location);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(revoke).toHaveBeenCalledExactlyOnceWith(location);
  });
});
