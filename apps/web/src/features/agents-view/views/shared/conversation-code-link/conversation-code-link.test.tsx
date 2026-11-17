import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationCodeLink } from './conversation-code-link';

vi.mock('@queries/storage/pr-mention', () => ({
  usePullRequestByGithubKeyQuery: () => ({ isSuccess: false }),
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/PullRequestMention',
  () => ({
    PullRequestPreviewCard: () => null,
    UnsyncedPullRequestPreviewCard: () => null,
  })
);
afterEach(cleanup);

describe('conversation code preview', () => {
  it('opens branch details from a named keyboard target without opening the row', async () => {
    const openRow = vi.fn();
    const copy = vi.fn(async () => true);
    const external = vi.fn();
    render(() => (
      <ConversationCodeLink
        details={{ repository: 'example/project', branch: 'fix/example' }}
        actions={{
          openPullRequest: vi.fn(),
          openBranch: external,
          copyBranch: copy,
          unarchive: async () => true,
        }}
        onOpenRow={openRow}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Branch details' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByText('fix/example')).toBeTruthy();
    expect(openRow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy branch name' }));
    expect(copy).toHaveBeenCalledWith('fix/example');
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }));
    expect(external).toHaveBeenCalledWith(
      'https://github.com/example/project/tree/fix%2Fexample'
    );
  });
});
