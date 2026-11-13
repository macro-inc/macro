import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { NEW_STACK_DRAFT, rulesFromDraft } from '../core/stack';
import { createStackEditor } from './stack-editor';

describe('createStackEditor', () => {
  it('builds the support stack from a name and a channel name', () => {
    createRoot((dispose) => {
      const editor = createStackEditor(NEW_STACK_DRAFT);
      expect(editor.problem()).toBe('name');

      editor.setName('Support channels');
      expect(editor.problem()).toBe('capture');

      expect(editor.addNameText('  macro support ')).toBe(true);
      expect(editor.problem()).toBeUndefined();
      expect(rulesFromDraft(editor.draft())).toEqual({
        capture: [
          {
            sources: [{ type: 'channelNameContains', text: 'macro support' }],
            channelTypes: [],
            kinds: [],
            senders: [],
          },
        ],
        // A new stack lets mentions and replies through.
        release: [
          { sources: [], channelTypes: [], kinds: ['mention'], senders: [] },
          { sources: [], channelTypes: [], kinds: ['reply'], senders: [] },
        ],
      });
      dispose();
    });
  });

  it('adds a channel name once, whatever its case, and never an empty one', () => {
    createRoot((dispose) => {
      const editor = createStackEditor(NEW_STACK_DRAFT);
      expect(editor.addNameText('   ')).toBe(false);
      expect(editor.addNameText('Support')).toBe(true);
      expect(editor.addNameText('support')).toBe(false);
      expect(editor.draft().sources).toEqual([
        { type: 'channelNameContains', text: 'Support' },
      ]);
      dispose();
    });
  });

  it('picks and removes places and people by kind', () => {
    createRoot((dispose) => {
      const editor = createStackEditor(NEW_STACK_DRAFT);
      editor.setEntityIds('channel', ['channel-1', 'channel-2']);
      editor.setEntityIds('person', ['macro|sam@example.com']);
      editor.addNameText('support');

      editor.setEntityIds('channel', ['channel-2']);
      expect(editor.entityIds('channel')).toEqual(['channel-2']);
      expect(editor.draft().sources).toContainEqual({
        type: 'channelNameContains',
        text: 'support',
      });

      editor.removeSource({ type: 'channel', id: 'channel-2' });
      editor.removeSender('macro|sam@example.com');
      expect(editor.entityIds('channel')).toEqual([]);
      expect(editor.entityIds('person')).toEqual([]);
      dispose();
    });
  });

  it('captures only the kinds checked, and every kind when none is', () => {
    createRoot((dispose) => {
      const editor = createStackEditor(NEW_STACK_DRAFT);
      editor.setKind('reaction', true);
      editor.setKind('newMessage', true);
      editor.setKind('reaction', false);
      expect(editor.draft().kinds).toEqual(['newMessage']);

      editor.setKind('newMessage', false);
      expect(editor.draft().kinds).toEqual([]);
      dispose();
    });
  });
});
