import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Footer: (props: ParentProps) => props.children,
    Section: () => null,
    Loading: () => null,
  },
  GithubPullRequestChecksContent: () => null,
}));
vi.mock('./PrLinkedWorkSection', () => ({ PrLinkedWorkSection: () => null }));
vi.mock('./PrAgentSessionsSection', () => ({
  PrAgentSessionsSection: () => null,
}));

import { PrSidePanelSections } from './PrSidePanelSections';

const pullRequest = {
  displayName: 'macro-inc/macro#7858',
  githubKey: 'macro-inc/macro#7858',
  number: 7858,
  owner: 'macro-inc',
  repo: 'macro',
  url: 'https://github.com/macro-inc/macro/pull/7858',
};

beforeEach(() => {
  vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PR side-panel external link', () => {
  it.each([false, true])(
    'uses native anchor semantics rather than a frontend opener (Tauri: %s)',
    (native) => {
      if (native) vi.stubGlobal('__TAURI_INTERNALS__', {});
      render(() => (
        <aside onClick={(event) => event.stopPropagation()}>
          <PrSidePanelSections enrichment={pullRequest} status="success" />
        </aside>
      ));
      const link = screen.getByRole('link', {
        name: pullRequest.displayName,
      });
      expect(link.getAttribute('href')).toBe(pullRequest.url);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');

      for (const init of [
        { detail: 1 },
        { detail: 0 },
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
      ]) {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ...init,
        });
        link.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(window.open).not.toHaveBeenCalled();
    }
  );
});
