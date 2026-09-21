/**
 * @vitest-environment jsdom
 */

import { CURSOR_BOT_PRINCIPAL_ID } from '@core/constant/cursorAgent';
import SparkleIcon from '@phosphor/sparkle.svg';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserIcon } from './UserIcon';

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));

vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock('@core/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/user')>();
  return {
    ...actual,
    useIsConnectedSecondaryInbox: () => () => false,
  };
});

afterEach(cleanup);

describe('UserIcon bot fallback', () => {
  it('uses the agent sparkle for bot principals without a photo', () => {
    const { container: sparkle } = render(() => (
      <SparkleIcon class="size-[62%]" />
    ));
    const expected = sparkle.querySelector('svg')?.innerHTML;

    const { container } = render(() => (
      <UserIcon
        id={CURSOR_BOT_PRINCIPAL_ID}
        size="fill"
        suppressClick
        showTooltip={false}
      />
    ));

    expect(container.querySelector('svg')?.innerHTML).toBe(expected);
  });
});
