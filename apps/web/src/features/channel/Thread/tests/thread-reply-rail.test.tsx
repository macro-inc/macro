import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadReplyRail } from '../ThreadReplyRail';

afterEach(cleanup);

describe('ThreadReplyRail', () => {
  it('renders a continuing spine and avatar branch by default', () => {
    const { container } = render(() => <ThreadReplyRail />);

    expect(container.querySelectorAll('.channel-rail-left')).toHaveLength(2);
    expect(container.querySelector('.channel-rail-bottom')).not.toBeNull();
  });

  it('stops at the avatar branch when terminal', () => {
    const { container } = render(() => <ThreadReplyRail terminal />);

    expect(container.querySelectorAll('.channel-rail-left')).toHaveLength(1);
    expect(container.querySelector('.channel-rail-bottom')).not.toBeNull();
  });

  it('renders no rail after a terminal grouped reply branch', () => {
    const { container } = render(() => <ThreadReplyRail grouped terminal />);

    expect(container.querySelector('.channel-rail-left')).toBeNull();
  });
});
