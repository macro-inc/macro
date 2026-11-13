import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatTools } from './FormatTools';

const mocks = vi.hoisted(() => ({
  hasLinks: false,
}));

vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    permissions: { canEdit: () => true, canComment: () => true },
    state: {
      editor: {
        md: {
          editor: undefined,
          titleEditor: undefined,
          get selection() {
            return { hasLinks: mocks.hasLinks };
          },
        },
        error: () => null,
      },
      generation: {
        isGenerating: () => false,
        generatedAndWaiting: () => false,
      },
    },
  }),
}));

afterEach(() => {
  mocks.hasLinks = false;
});

// Only MarkdownPopup renders FormatTools, always within the popup.
describe('FormatTools accessible names in the selection popup', () => {
  it('renders the already-named Bold button (control)', () => {
    render(() => <FormatTools withinPopup />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
  });

  it('names the More formatting trigger', () => {
    render(() => <FormatTools withinPopup />);
    expect(
      screen.getByRole('button', { name: 'More formatting' })
    ).toBeTruthy();
  });

  it('names the link button Insert Link', () => {
    render(() => <FormatTools withinPopup />);
    expect(screen.getByRole('button', { name: 'Insert Link' })).toBeTruthy();
  });

  it('names the link button Remove Link when the selection has links', () => {
    mocks.hasLinks = true;
    render(() => <FormatTools withinPopup />);
    expect(screen.getByRole('button', { name: 'Remove Link' })).toBeTruthy();
  });
});
