import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createCodeLinkDescriber,
  createCodeLinkOpener,
  linkChangedCode,
} from './code-links';
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
  return {
    context,
    changes,
    open: createCodeLinkOpener(changes),
    describe: createCodeLinkDescriber(changes),
  };
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

  it('leaves a web address written without its scheme to the browser', () => {
    createRoot((dispose) => {
      const { context, open } = setup();
      expect(open('example.com')).toBe(false);
      expect(open('example.org')).toBe(false);
      expect(open('example.com/spec.html')).toBe(false);
      expect(open('docs.rs/serde')).toBe(false);
      expect(open('crates.io/crates/serde')).toBe(false);
      expect(open('192.168.1.1')).toBe(false);
      expect(open('192.168.1.1:8080')).toBe(false);
      expect(open('example.com:8080')).toBe(false);
      expect(context.opened).toEqual([]);
      expect(context.notified).toEqual([]);
      // Repository paths of the same look still open on GitHub.
      expect(open('package.json#L5')).toBe(true);
      expect(open('package.json:5')).toBe(true);
      // A #L line marks a file even when its name reads as a host.
      expect(open('main.tf#L3')).toBe(true);
      expect(open('.github/ci.yml')).toBe(true);
      expect(open('src/b.ts#L2')).toBe(true);
      // A bare docs or source file, and a version folder, are paths too.
      expect(open('README.md')).toBe(true);
      expect(open('v1.2/notes.md')).toBe(true);
      expect(open('my.md')).toBe(true);
      // The one trade-off: a bare docs.rs reads as a Rust file.
      expect(open('docs.rs')).toBe(true);
      expect(context.opened).toEqual([
        'https://github.com/macro-inc/macro/blob/abc123/package.json#L5',
        'https://github.com/macro-inc/macro/blob/abc123/package.json#L5',
        'https://github.com/macro-inc/macro/blob/abc123/main.tf#L3',
        'https://github.com/macro-inc/macro/blob/abc123/.github/ci.yml',
        'https://github.com/macro-inc/macro/blob/abc123/src/b.ts#L2',
        'https://github.com/macro-inc/macro/blob/abc123/README.md',
        'https://github.com/macro-inc/macro/blob/abc123/v1.2/notes.md',
        'https://github.com/macro-inc/macro/blob/abc123/my.md',
        'https://github.com/macro-inc/macro/blob/abc123/docs.rs',
      ]);
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

describe('createCodeLinkDescriber', () => {
  it('names the file and its lines, with the folder beneath', () => {
    createRoot((dispose) => {
      const { describe } = setup();
      expect(describe('apps/web/src/a.ts#L2')).toEqual({
        title: 'a.ts, line 2',
        subtitle: 'apps/web/src',
      });
      expect(describe('crates/x/src/lib.rs#L3-L9')).toEqual({
        title: 'lib.rs, lines 3-9',
        subtitle: 'crates/x/src',
      });
      expect(describe('package.json#L5')).toEqual({
        title: 'package.json, line 5',
        subtitle: '',
      });
      dispose();
    });
  });

  it('leaves links the opener leaves alone', () => {
    createRoot((dispose) => {
      const { describe } = setup();
      expect(describe('https://example.com/a.ts')).toBeUndefined();
      expect(describe('example.com')).toBeUndefined();
      expect(describe('apps/web/src')).toBeUndefined();
      dispose();
    });
  });
});
