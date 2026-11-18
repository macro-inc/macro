/** @vitest-environment jsdom */

// Source opens every stored node below and passes the null or omitted value
// on to a feature query or helper. Tests marked "known gap" pin the current
// native refusal, which fails the whole document; each is flipped to an
// admission test once that feature accepts null.

import {
  AccountManagerRequestNode,
  AgentActivityNode,
  AgentContextNode,
  AwaitNode,
  CursorSystemNotificationNode,
  MagicChipNode,
  PullRequestMentionNode,
  ReplyTargetNode,
  SnapshotNode,
  WatermarkNode,
} from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import {
  type MacroDecorators,
  registerMacroDecoratorViews,
} from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import type { Klass, LexicalNode } from 'lexical';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { theme } from '../theme';
import { createNativeFastCachedDecoratorViews } from './fast-cached-views';
import { createNativeFastStaticDecoratorViews } from './fast-static-views';
import { createNativeContactContext } from './native-contact-host';
import { createNativeMagicDecoratorContext } from './native-magic-host';
import {
  createNativePullRequestMentionContext,
  createNativePullRequestMentionViews,
} from './native-pr-mention-views';
import {
  createNativeSnapshotContext,
  createNativeSnapshotViews,
} from './native-snapshot-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

interface Family {
  readonly rows: readonly Klass<LexicalNode>[];
  create(): { views: Partial<MacroDecorators>; dispose(): void };
}

const STATIC: Family = {
  rows: [
    ReplyTargetNode,
    AccountManagerRequestNode,
    CursorSystemNotificationNode,
    WatermarkNode,
    AwaitNode,
    AgentContextNode,
  ],
  create() {
    const context = createNativeContactContext(theme);
    return {
      views: createNativeFastStaticDecoratorViews(context),
      dispose: context.dispose,
    };
  },
};
const CACHED: Family = {
  rows: [AgentActivityNode, MagicChipNode],
  create() {
    const context = createNativeMagicDecoratorContext(theme, 'markdown-sync');
    return {
      views: createNativeFastCachedDecoratorViews(context),
      dispose: context.dispose,
    };
  },
};
const SNAPSHOT: Family = {
  rows: [SnapshotNode],
  create() {
    const context = createNativeSnapshotContext(theme);
    return {
      views: createNativeSnapshotViews(context),
      dispose: context.dispose,
    };
  },
};
const PULL_REQUEST: Family = {
  rows: [PullRequestMentionNode],
  create() {
    const context = createNativePullRequestMentionContext(theme);
    return {
      views: createNativePullRequestMentionViews(context),
      dispose: context.dispose,
    };
  },
};

/**
 * Opens one stored node beside a sibling paragraph. Components are inert;
 * the optional recorder replaces one row to capture its projected props.
 */
function open(
  family: Family,
  node: object,
  inline: boolean,
  recorder?: { row: Klass<LexicalNode>; received: unknown[] }
) {
  for (const row of family.rows) setDecorator(row, () => null);
  if (recorder)
    setDecorator<{}>(recorder.row, (props) => {
      recorder.received.push(props);
      return null;
    });
  const fixture = nativeSurface();
  const { views, dispose } = family.create();
  registerMacroDecoratorViews(fixture.view.registry, views);
  const close = () => {
    dispose();
    fixture.close();
  };
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            inline ? { type: 'paragraph', version: 1, children: [node] } : node,
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ],
        },
      })
    );
  } catch (error) {
    // An expected refusal must not leak the constructed session and root.
    close();
    throw error;
  }
  close();
}

function without(node: Record<string, unknown>, field: string) {
  return Object.fromEntries(
    Object.entries(node).filter(([key]) => key !== field)
  );
}

const GRANT = {
  type: 'account-manager-request',
  version: 1,
  grantId: 'probe-grant',
};
const ACTIVITY = {
  type: 'agent-activity',
  version: 1,
  agentSessionId: '00000000-0000-4000-8000-000000000001',
  turn: 1,
  segment: 0,
  sealed: true,
  rows: [{ id: 'r1', label: 'Read file', status: 'completed' }],
};
const MAGIC = {
  type: 'magic-chip',
  version: 5,
  agentSessionId: '00000000-0000-4000-8000-000000000001',
  promptedMessage: null,
  status: 'no_messages',
};
const SNAPSHOT_NODE = {
  type: 'snapshot',
  version: 1,
  documentId: 'probe-doc',
  documentName: 'Probe Doc',
  blockName: 'md',
  content: 'Snapshot body text',
  snapshotDate: '2026-11-01T00:00:00Z',
};
const PR = {
  type: 'pr-mention',
  version: 1,
  id: 'probe-pr',
  label: 'Probe PR #1',
  url: 'https://github.com/example/repo/pull/1',
};

test('controls: the valid stored nodes open', () => {
  open(STATIC, GRANT, true);
  open(CACHED, ACTIVITY, false);
  open(CACHED, MAGIC, true);
  open(SNAPSHOT, SNAPSHOT_NODE, false);
  open(PULL_REQUEST, PR, true);
});

test('account manager: projector hands a stored null or missing grant id to the registered component unchanged', () => {
  const received: unknown[] = [];
  for (const node of [
    GRANT,
    { ...GRANT, grantId: null },
    without(GRANT, 'grantId'),
  ])
    open(STATIC, node, true, { row: AccountManagerRequestNode, received });
  expect(
    received.map((props) => Reflect.get(Object(props), 'grantId'))
  ).toEqual(['probe-grant', null, undefined]);
});

test('account manager: stored model refuses a wrong grant id type', () => {
  expect(() => open(STATIC, { ...GRANT, grantId: 5 }, true)).toThrow(
    'JSON error: invalid type'
  );
});

test('known gap: stored null or missing agent activity session and position fields are refused', () => {
  for (const node of [
    { ...ACTIVITY, agentSessionId: null },
    without(ACTIVITY, 'agentSessionId'),
    { ...ACTIVITY, turn: null },
    { ...ACTIVITY, segment: null },
    without(ACTIVITY, 'segment'),
    { ...ACTIVITY, sealed: null },
  ])
    expect(() => open(CACHED, node, false)).toThrow(
      'Invalid agent activity payload'
    );
});

test('known gap: a stored null or missing magic chip session id is refused', () => {
  for (const node of [
    { ...MAGIC, agentSessionId: null },
    without(MAGIC, 'agentSessionId'),
  ])
    expect(() => open(CACHED, node, true)).toThrow(
      'Invalid magic chip payload'
    );
});

test('known gap: a stored null snapshot document id is refused', () => {
  expect(() =>
    open(SNAPSHOT, { ...SNAPSHOT_NODE, documentId: null }, false)
  ).toThrow('Invalid native Snapshot payload');
});

test('pull request: projector hands a stored null or missing id to the registered component unchanged', () => {
  const received: unknown[] = [];
  for (const node of [PR, { ...PR, id: null }, without(PR, 'id')])
    open(PULL_REQUEST, node, true, { row: PullRequestMentionNode, received });
  expect(received.map((props) => Reflect.get(Object(props), 'id'))).toEqual([
    'probe-pr',
    null,
    undefined,
  ]);
});

test('pull request: stored model refuses a wrong id type', () => {
  expect(() => open(PULL_REQUEST, { ...PR, id: 5 }, true)).toThrow(
    'JSON error: invalid type'
  );
});
