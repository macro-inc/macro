/** @vitest-environment jsdom */

import { PullRequestMentionNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { PullRequestMentionUIProps } from '../component/decorator/PullRequestMention';
import { theme } from '../theme';
import {
  createNativePullRequestMentionContext,
  createNativePullRequestMentionViews,
} from './native-pr-mention-views';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('../plugins/group-b/command', () => ({
  dispatchApplicationCommandIfSessionEdit: mocks.dispatch,
}));

beforeAll(initializeNativeSurfaceTests);
afterEach(() => {
  clearDecorators();
  mocks.dispatch.mockReset();
});

const PR = {
  type: 'pr-mention',
  version: 1,
  label: 'Probe PR #1',
  url: 'https://github.com/example/repo/pull/1',
};

/** The expected node the enrichment command sends for one stored mention. */
function enrichedExpectation(node: object) {
  const received: PullRequestMentionUIProps[] = [];
  setDecorator<PullRequestMentionUIProps>(PullRequestMentionNode, (props) => {
    received.push(props);
    return null;
  });
  const fixture = nativeSurface();
  const context = createNativePullRequestMentionContext(theme);
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativePullRequestMentionViews(context)
  );
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'paragraph', version: 1, children: [node] }],
        },
      })
    );
    const props = received.at(-1);
    if (!props?.host) throw new Error('Missing projected PR mention host');
    props.host.enrich(props.key, 'Enriched title', PR.url);
    const [, command, payload] = mocks.dispatch.mock.calls.at(-1) ?? [];
    expect(command).toBe('group-b.pr-enrich');
    return Reflect.get(Object(payload), 'expected');
  } finally {
    context.dispose();
    fixture.close();
  }
}

// The stored model keeps an omitted id apart from a null one, so the
// compare-and-set expectation must carry the same shape.
test('enrichment expects an omitted id as omitted and a null id as null', () => {
  expect(enrichedExpectation(PR)).toStrictEqual({
    label: PR.label,
    url: PR.url,
  });
  expect(enrichedExpectation({ ...PR, id: null })).toStrictEqual({
    id: null,
    label: PR.label,
    url: PR.url,
  });
  expect(enrichedExpectation({ ...PR, id: 'probe-pr' })).toStrictEqual({
    id: 'probe-pr',
    label: PR.label,
    url: PR.url,
  });
});
