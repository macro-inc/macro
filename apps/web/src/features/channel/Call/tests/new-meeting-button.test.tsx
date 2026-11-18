/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewMeetingButton } from '../NewMeetingButton';

vi.mock('@app/features/meetings/manage-meetings-dialog', () => ({
  ManageMeetingsDialog: () => <div>Manage dialog</div>,
}));

describe('NewMeetingButton', () => {
  let motionStyles: HTMLStyleElement;
  beforeEach(() => {
    // jsdom omits the CSS motion defaults required by Kobalte's presence tracking.
    motionStyles = document.createElement('style');
    motionStyles.textContent =
      '[role="menu"] { animation-name: none; transition-duration: 0s; }';
    document.head.append(motionStyles);
    vi.stubGlobal('scrollTo', vi.fn());
  });
  afterEach(() => {
    cleanup();
    motionStyles.remove();
    vi.unstubAllGlobals();
  });

  it('offers an instant call first', async () => {
    const onInstantCall = vi.fn();
    const onChannelCall = vi.fn();
    render(() => (
      <NewMeetingButton
        onChannelCall={onChannelCall}
        onInstantCall={onInstantCall}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'New call' }), {
      key: 'Enter',
    });
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Start an instant call',
      'Call a channel or contact',
      'Manage call links',
    ]);

    fireEvent.keyDown(items[0], { key: 'Enter' });
    expect(onInstantCall).toHaveBeenCalledOnce();
    expect(onChannelCall).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
