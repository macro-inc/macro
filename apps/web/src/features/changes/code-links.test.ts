import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createCodeLinkOpener, linkChangedCode } from './code-links';
import type { DiffStyle, PaneLayout } from './core/layout';
import { createChanges } from './primitives/create-changes';
import { createMockChangesContext, mockChangeset } from './tests/mock-context';

function setup(canHaveChanges = true) {
  const context = createMockChangesContext({
    summary: {
      changeset: mockChangeset({
        head: { name: 'agent/branch', sha: 'abc123' },
      }),
      capturing: false,
    },
  });
  context.host.canHaveChanges = () => canHaveChanges;
  const [layout, setLayout] = createSignal<PaneLayout>('closed');
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified');
  const [dismissed, setDismissed] = createSignal<string>();
  const changes = createChanges({
    context,
    view: { layout, setLayout, diffStyle, setDiffStyle },
    dismissed: [dismissed, setDismissed],
  });
  return { context, changes, open: createCodeLinkOpener(changes) };
}

describe('createCodeLinkOpener', () => {
  it('opens the pane on a changed file and points at its lines', () => {
    createRoot((dispose) => {
      const { changes, open } = setup();
      expect(open('/home/u/macro/crates/x/src/lib.rs:2')).toBe(true);
      expect(changes.layout.changesVisible()).toBe(true);
      expect(changes.review.active()).toBe('crates/x/src/lib.rs');
      expect(changes.review.pointed()).toEqual({
        path: 'crates/x/src/lib.rs',
        side: 'additions',
        lineNumber: 2,
        endLineNumber: 2,
      });

      expect(open('apps/web/src/a.ts')).toBe(true);
      expect(changes.review.active()).toBe('apps/web/src/a.ts');
      expect(changes.review.pointed()).toBeUndefined();
      dispose();
    });
  });

  it('opens an unchanged relative file on GitHub at the head commit', () => {
    createRoot((dispose) => {
      const { context, changes, open } = setup();
      expect(open('docs/guide.md#L3-L5')).toBe(true);
      expect(context.opened).toEqual([
        'https://github.com/macro-inc/macro/blob/abc123/docs/guide.md#L3-L5',
      ]);
      expect(changes.layout.changesVisible()).toBe(false);
      dispose();
    });
  });

  it('says so for an unchanged absolute file, and declines other links', () => {
    createRoot((dispose) => {
      const { context, open } = setup();
      expect(open('/home/u/macro/docs/guide.md')).toBe(true);
      expect(context.notified).toEqual([
        {
          message:
            '/home/u/macro/docs/guide.md is not one of the changed files',
          tone: 'failure',
        },
      ]);
      expect(open('https://example.com/a.ts')).toBe(false);
      expect(open('docs/setup')).toBe(false);
      expect(context.opened).toEqual([]);
      dispose();
    });
  });

  it('declines everything when the host can have no changes', () => {
    createRoot((dispose) => {
      const { changes, open } = setup(false);
      expect(open('apps/web/src/a.ts')).toBe(false);
      expect(linkChangedCode(changes, 'See `apps/web/src/a.ts`.')).toBe(
        'See `apps/web/src/a.ts`.'
      );
      dispose();
    });
  });
});
