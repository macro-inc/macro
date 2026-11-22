/** @vitest-environment jsdom */
import {
  AccountManagerRequestNode,
  AgentActivityNode,
  AwaitNode,
  ConnectAppNode,
  CursorSystemNotificationNode,
  MagicChipNode,
  ReplyTargetNode,
} from '@macro-inc/lexical-core';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { createEditor } from 'lexical';
import { beforeAll, expect, test } from 'vitest';

beforeAll(initializeNativeSurfaceTests);

const NODES = [
  AccountManagerRequestNode,
  AgentActivityNode,
  AwaitNode,
  ConnectAppNode,
  CursorSystemNotificationNode,
  MagicChipNode,
  ReplyTargetNode,
];

/** One stored node per type whose createDOM writes a field as an attribute. */
const ROWS = [
  {
    attribute: 'data-account-manager-request',
    field: 'grantId',
    inline: true,
    node: { type: 'account-manager-request', version: 1, grantId: 'probe' },
  },
  {
    attribute: 'data-agent-activity',
    field: 'agentSessionId',
    inline: false,
    node: {
      type: 'agent-activity',
      version: 1,
      agentSessionId: 'probe',
      turn: 1,
      segment: 0,
      sealed: true,
      rows: [],
    },
  },
  {
    attribute: 'data-await-id',
    field: 'awaitId',
    inline: true,
    node: { type: 'await', version: 1, awaitId: 'probe', inline: true },
  },
  {
    attribute: 'data-connect-app',
    field: 'appSlug',
    inline: true,
    node: {
      type: 'connect-app',
      version: 2,
      appSlug: 'probe',
      name: 'Probe',
      target: 'harness',
    },
  },
  {
    attribute: 'data-system-notification',
    field: 'source',
    inline: false,
    node: {
      type: 'system-notification',
      version: 1,
      source: 'probe',
      attributes: {},
      text: 'Probe',
    },
  },
  {
    attribute: 'data-magic-chip',
    field: 'agentSessionId',
    inline: false,
    node: {
      type: 'magic-chip',
      version: 5,
      agentSessionId: 'probe',
      status: 'no_messages',
    },
  },
  {
    attribute: 'data-reply-target-node',
    field: 'targetMessageId',
    inline: false,
    node: {
      type: 'reply-target',
      version: 2,
      parent: { type: 'channel', id: 'probe-channel' },
      targetMessageId: 'probe',
      targetThreadId: 'probe-thread',
      displayText: 'Probe',
      senderId: 'probe-sender',
    },
  },
] as const;

const STORED = ['text', 'null', 'missing'] as const;

function variant(node: Record<string, unknown>, field: string, stored: string) {
  if (stored === 'text') return node;
  if (stored === 'null') return { ...node, [field]: null };
  return Object.fromEntries(Object.entries(node).filter(([k]) => k !== field));
}

function stored(node: object, inline: boolean) {
  const paragraph = (children: object[]) => ({
    type: 'paragraph',
    version: 1,
    children,
  });
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: inline
        ? [paragraph([node])]
        : [paragraph([]), node, paragraph([])],
    },
  });
}

/** The attribute Source's reconciler writes for the stored node. */
function source(state: string, attribute: string) {
  const editor = createEditor({
    nodes: NODES,
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  editor.setRootElement(root);
  try {
    editor.setEditorState(editor.parseEditorState(state));
    const element = root.querySelector(`[${attribute}]`);
    if (!element) throw new Error('Missing Source decorator element');
    return element.getAttribute(attribute);
  } finally {
    editor.setRootElement(null);
  }
}

/** The attribute native writes for the same stored node. */
function native(state: string, type: string, attribute: string) {
  const fixture = nativeSurface();
  try {
    registerMacroDecoratorViews(fixture.view.registry, {
      [type]: () => document.createTextNode('Decorator'),
    });
    fixture.port.setState(state);
    const element = fixture.root.querySelector(`[${attribute}]`);
    if (!element) throw new Error('Missing native decorator element');
    return element.getAttribute(attribute);
  } finally {
    fixture.close();
  }
}

function rowFor(type: string) {
  const row = ROWS.find((candidate) => candidate.node.type === type);
  if (!row) throw new Error(`Missing row ${type}`);
  return row;
}

// Source createDOM calls setAttribute(name, this.__field) with the stored
// value as is, so null becomes "null" and an omitted field "undefined".
test.each(
  ['account-manager-request', 'agent-activity', 'connect-app', 'magic-chip']
    .map(rowFor)
    .flatMap((row) => STORED.map((kind) => ({ ...row, kind })))
)(
  '$node.type stored $kind $field: native writes $attribute as Source does',
  ({ attribute, field, inline, node, kind }) => {
    const state = stored(variant(node, field, kind), inline);
    const expected = source(state, attribute);
    expect(expected).toBe(
      kind === 'text' ? 'probe' : kind === 'null' ? 'null' : 'undefined'
    );
    expect(native(state, node.type, attribute)).toBe(expected);
  }
);

test.each(['await', 'system-notification', 'reply-target'].map(rowFor))(
  '$node.type stored text $field: native writes $attribute as Source does',
  ({ attribute, inline, node }) => {
    const state = stored(node, inline);
    expect(source(state, attribute)).toBe('probe');
    expect(native(state, node.type, attribute)).toBe('probe');
  }
);

// Both engines mint a fresh id for an Await stored without one, so only the
// shape is comparable, never the value.
test.each(['null', 'missing'] as const)(
  'await stored %s awaitId: both engines write a minted id',
  (kind) => {
    const row = rowFor('await');
    const state = stored(variant(row.node, row.field, kind), row.inline);
    for (const value of [
      source(state, row.attribute),
      native(state, 'await', row.attribute),
    ]) {
      expect(value).toMatch(/^[\w-]{10,}$/);
    }
  }
);

// Retained strict boundary: both engines refuse these documents outright.
test.each(
  ['system-notification', 'reply-target']
    .map(rowFor)
    .flatMap((row) =>
      (['null', 'missing'] as const).map((kind) => ({ ...row, kind }))
    )
)(
  '$node.type stored $kind $field: both engines refuse the document',
  ({ attribute, field, inline, node, kind }) => {
    const state = stored(variant(node, field, kind), inline);
    expect(() => source(state, attribute)).toThrow(/invalid/);
    expect(() => native(state, node.type, attribute)).toThrow(/JSON error/);
  }
);
