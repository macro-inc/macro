/** @vitest-environment jsdom */

import { AgentSessionMentionNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { AgentSessionMentionUIProps } from '../component/decorator/AgentSessionMention';
import { theme } from '../theme';
import { createNativeAgentSessionMentionContext } from './native-agent-session-mention-host';
import { createNativeAgentSessionMentionViews } from './native-agent-session-mention-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored mentions (inline, in one paragraph) beside a sibling
 * paragraph, hands the result to `check`, and always closes the fixture.
 */
function withMounted(
  mentions: readonly object[],
  check: (mounted: {
    root: HTMLElement;
    received: AgentSessionMentionUIProps[];
  }) => void
) {
  const received: AgentSessionMentionUIProps[] = [];
  setDecorator<AgentSessionMentionUIProps>(AgentSessionMentionNode, (props) => {
    received.push(props);
    return <span data-recorded-agent-session="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeAgentSessionMentionContext(theme, () => true);
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeAgentSessionMentionViews(context)
    );
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: mentions.map((mention) => ({
                type: 'agent-session-mention',
                version: 3,
                ...mention,
              })),
            },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ],
        },
      })
    );
    check({ root: fixture.root, received });
  } finally {
    context.dispose();
    fixture.close();
  }
}

const fields = ({
  id,
  label,
  mentionUuid,
  expanded,
}: AgentSessionMentionUIProps) => ({ id, label, mentionUuid, expanded });

test('a stored null or missing label and mention id reach the component unchanged', () => {
  withMounted(
    [
      { id: 'valid', label: 'Valid', mentionUuid: 'm-1' },
      { id: 'null-label', label: null, mentionUuid: null },
      { id: 'missing-label' },
      { id: 'empty-label', label: '', mentionUuid: '' },
    ],
    ({ received }) => {
      expect(received.map(fields)).toEqual([
        {
          id: 'valid',
          label: 'Valid',
          mentionUuid: 'm-1',
          expanded: undefined,
        },
        {
          id: 'null-label',
          label: null,
          mentionUuid: null,
          expanded: undefined,
        },
        {
          id: 'missing-label',
          label: undefined,
          mentionUuid: undefined,
          expanded: undefined,
        },
        {
          id: 'empty-label',
          label: '',
          mentionUuid: '',
          expanded: undefined,
        },
      ]);
      expect(received.every((props) => !('expanded' in props))).toBe(true);
    }
  );
});

// Known gap: Source renders these with the fallback label and no preview.
test('a null or missing id is refused', () => {
  for (const mention of [
    { id: null, label: 'Null Id' },
    { label: 'Missing Id' },
  ]) {
    expect(() => withMounted([mention], () => {})).toThrow(
      'Invalid agent session mention payload'
    );
  }
});

test('a null-heavy mention leaves the rest of the document rendering', () => {
  withMounted([{ id: 'a-1', label: null, mentionUuid: null }], ({ root }) => {
    expect(
      root.querySelectorAll('[data-recorded-agent-session="true"]')
    ).toHaveLength(1);
    expect(root.textContent).toContain('sibling stays');
  });
});

test('expanded reaches the component only when true, as Source exportComponentProps spreads it', () => {
  // Source keeps a stored null flag, which is falsy, so it omits it too.
  withMounted(
    [
      { id: 'collapsed', expanded: false },
      { id: 'null-flag', expanded: null },
      { id: 'open', expanded: true },
    ],
    ({ received }) => {
      expect(
        received.map((props) => [props.id, 'expanded' in props, props.expanded])
      ).toEqual([
        ['collapsed', false, undefined],
        ['null-flag', false, undefined],
        ['open', true, true],
      ]);
    }
  );
});

test('wrong value types are refused by the stored model before any projection', () => {
  for (const mention of [
    { id: 5, label: 'Five' },
    { id: 'text-label', label: 7 },
    { id: 'text-uuid', mentionUuid: true },
    { id: 'text-flag', expanded: 'yes' },
  ]) {
    expect(() => withMounted([mention], () => {})).toThrow(
      'JSON error: invalid type'
    );
  }
});
