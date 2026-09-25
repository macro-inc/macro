import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MagicChipView } from './MagicChipView';

vi.mock('./MagicChipPullRequest', () => ({
  MagicChipPullRequest: (props: { url: string }) => (
    <a data-testid="resolved-pr" href={props.url}>
      Pull request
    </a>
  ),
}));
afterEach(cleanup);

describe('MagicChipView host controls', () => {
  it('opens the session from the card with mouse and keyboard', () => {
    const onOpen = vi.fn();
    render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'Ready for review' }}
        onOpen={onOpen}
      />
    ));
    const card = screen.getByRole('button', { name: 'Open agent session' });
    fireEvent.click(screen.getByText('Ready for review'));
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('keeps host PR and merge controls independent of opening the session', () => {
    const onOpen = vi.fn();
    const onPr = vi.fn();
    const onMerge = vi.fn();
    render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'Ready for review' }}
        header={{
          pullRequestUrl: 'https://github.com/macro-inc/macro/pull/482',
        }}
        pullRequest={
          <button type="button" onClick={onPr}>
            PR #482
          </button>
        }
        headerActions={
          <button type="button" onClick={onMerge}>
            Merge
          </button>
        }
        onOpen={onOpen}
      />
    ));
    expect(screen.queryByTestId('resolved-pr')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PR #482' }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(onPr).toHaveBeenCalledOnce();
    expect(onMerge).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
