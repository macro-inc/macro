import { describe, expect, it } from 'vitest';
import {
  capturesChannel,
  capturesChannelName,
  captureWithChannel,
  draftFromStack,
  draftProblem,
  entityIds,
  NEW_STACK_DRAFT,
  rulesFromDraft,
  type Stack,
  type StackDraft,
  type StackRule,
  withEntityIds,
} from './stack';

const rule = (overrides: Partial<StackRule>): StackRule => ({
  sources: [],
  channelTypes: [],
  kinds: [],
  senders: [],
  ...overrides,
});

const supportDraft: StackDraft = {
  name: 'Support channels',
  sources: [{ type: 'channelNameContains', text: 'macro support' }],
  senders: [],
  kinds: [],
  releaseMentions: true,
  releaseReplies: true,
};

const stackOf = (draft: StackDraft): Stack => ({
  id: 'stack-1',
  name: draft.name,
  enabled: true,
  ...rulesFromDraft(draft),
});

describe('rulesFromDraft', () => {
  it('captures the named places and releases mentions and replies', () => {
    expect(rulesFromDraft(supportDraft)).toEqual({
      capture: [
        rule({
          sources: [{ type: 'channelNameContains', text: 'macro support' }],
        }),
      ],
      release: [rule({ kinds: ['mention'] }), rule({ kinds: ['reply'] })],
    });
  });

  it('releases nothing when both switches are off', () => {
    const rules = rulesFromDraft({
      ...supportDraft,
      releaseMentions: false,
      releaseReplies: false,
    });
    expect(rules.release).toEqual([]);
  });
});

describe('draftFromStack', () => {
  it('reads back what the editor saved', () => {
    const draft: StackDraft = {
      name: 'Bots',
      sources: [
        { type: 'channel', id: 'channel-1' },
        { type: 'folder', id: 'folder-1' },
      ],
      senders: ['macro|sam@example.com'],
      kinds: ['reaction', 'newMessage'],
      releaseMentions: false,
      releaseReplies: true,
    };
    expect(draftFromStack(stackOf(draft))).toEqual(draft);
  });

  it('refuses rules the editor cannot show, so saving cannot drop them', () => {
    const base = stackOf(supportDraft);

    const twoCaptureRules = {
      ...base,
      capture: [...base.capture, rule({ kinds: ['reaction'] })],
    };
    expect(draftFromStack(twoCaptureRules)).toBeUndefined();

    const byChannelType = {
      ...base,
      capture: [rule({ channelTypes: ['public'] })],
    };
    expect(draftFromStack(byChannelType)).toBeUndefined();

    const releasesASender = {
      ...base,
      release: [rule({ senders: ['macro|sam@example.com'] })],
    };
    expect(draftFromStack(releasesASender)).toBeUndefined();
  });
});

describe('draftProblem', () => {
  it('needs a name', () => {
    expect(draftProblem({ ...supportDraft, name: '  ' })).toBe('name');
  });

  it('needs a place, person or kind, or the stack would capture everything', () => {
    expect(draftProblem({ ...NEW_STACK_DRAFT, name: 'Everything' })).toBe(
      'capture'
    );
    expect(
      draftProblem({
        ...NEW_STACK_DRAFT,
        name: 'Reactions',
        kinds: ['reaction'],
      })
    ).toBeUndefined();
    expect(draftProblem(supportDraft)).toBeUndefined();
  });
});

describe('entity ids', () => {
  const draft: StackDraft = {
    ...supportDraft,
    sources: [
      { type: 'channelNameContains', text: 'macro support' },
      { type: 'channel', id: 'channel-1' },
      { type: 'document', id: 'document-1' },
    ],
    senders: ['macro|sam@example.com'],
  };

  it('reads the ids of one kind', () => {
    expect(entityIds(draft, 'channel')).toEqual(['channel-1']);
    expect(entityIds(draft, 'folder')).toEqual([]);
    expect(entityIds(draft, 'person')).toEqual(['macro|sam@example.com']);
  });

  it('replaces one kind and leaves the others', () => {
    const next = withEntityIds(draft, 'channel', ['channel-2', 'channel-3']);
    expect(next.sources).toEqual([
      { type: 'channelNameContains', text: 'macro support' },
      { type: 'document', id: 'document-1' },
      { type: 'channel', id: 'channel-2' },
      { type: 'channel', id: 'channel-3' },
    ]);
    expect(withEntityIds(draft, 'person', []).senders).toEqual([]);
  });
});

describe('adding a channel to a stack', () => {
  const stack = stackOf({
    ...supportDraft,
    kinds: ['newMessage'],
  });

  it('knows a channel its name rule already captures, whatever the case', () => {
    expect(capturesChannelName(stack, 'Macro Support: Acme')).toBe(true);
    expect(capturesChannelName(stack, 'engineering')).toBe(false);
    // A stack that only lists channels matches none by name.
    const listed = { ...stack, capture: captureWithChannel(stack, 'c', true) };
    expect(
      capturesChannelName(
        {
          ...listed,
          capture: [rule({ sources: [{ type: 'channel', id: 'c' }] })],
        },
        'Macro Support: Acme'
      )
    ).toBe(false);
  });

  it('adds the channel to the first capture rule and keeps its other conditions', () => {
    expect(capturesChannel(stack, 'channel-1')).toBe(false);

    const capture = captureWithChannel(stack, 'channel-1', true);
    expect(capture).toEqual([
      rule({
        sources: [
          { type: 'channelNameContains', text: 'macro support' },
          { type: 'channel', id: 'channel-1' },
        ],
        kinds: ['newMessage'],
      }),
    ]);
    expect(capturesChannel({ ...stack, capture }, 'channel-1')).toBe(true);
    // Adding it again changes nothing.
    expect(
      captureWithChannel({ ...stack, capture }, 'channel-1', true)
    ).toEqual(capture);
  });

  it('takes the channel out again', () => {
    const capture = captureWithChannel(stack, 'channel-1', true);
    expect(
      captureWithChannel({ ...stack, capture }, 'channel-1', false)
    ).toEqual(stack.capture);
  });
});
