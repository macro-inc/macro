/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MagicChipView } from './MagicChipView';

// The pull request slot reaches for hosted queries this view test has no use
// for; the header row is what is under test.
vi.mock('./MagicChipPullRequest', () => ({
  MagicChipPullRequest: () => null,
}));

afterEach(cleanup);

it('opens the session from a button that keeps its name once the label is hidden', () => {
  const onOpen = vi.fn();
  render(() => (
    <MagicChipView
      agentSessionId="019f0000-0000-7000-8000-000000000001"
      presentation={{
        kind: 'working',
        activity: {
          label: 'Thinking',
          detail: 'Reading the header row',
          busy: true,
        },
      }}
      header={{ agent: 'Cursor Agent' }}
      onOpen={onOpen}
    />
  ));

  // On a phone the pill shows only its arrow, so the name has to come from the
  // button itself rather than the text beside it.
  const open = screen.getByRole('button', { name: 'View session' });
  expect(open.querySelector('.max-sm\\:hidden')?.textContent).toBe(
    'View session'
  );
  open.click();
  expect(onOpen).toHaveBeenCalledTimes(1);
});
