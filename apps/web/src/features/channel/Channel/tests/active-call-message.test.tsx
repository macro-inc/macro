/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { createSignal, Match, Switch } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { ActiveCallMessage } from '../ActiveCallMessage';
import { ChannelTabProvider } from '../ChannelTabContext';

vi.mock('@channel/Call/use-call', () => ({
  useCall: (_channelId: () => string, options?: { onJoin?: () => void }) => ({
    isInThisChannel: () => false,
    joinCall: async () => options?.onJoin?.(),
  }),
}));

vi.mock('@queries/call/call', () => ({
  useActiveCallQuery: () => ({
    data: { createdAt: '2026-09-25T14:00:00.000Z' },
  }),
}));

vi.mock('@phosphor/phone-call.svg', () => ({
  default: () => <span aria-hidden="true" />,
}));

vi.mock('@ui', () => ({
  Button: (props: {
    children: JSX.Element;
    disabled?: boolean;
    onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

describe('ActiveCallMessage', () => {
  it('opens the call when the user clicks Join', async () => {
    const [activeTab, setActiveTab] = createSignal<'messages' | 'call'>(
      'messages'
    );

    render(() => (
      <ChannelTabProvider
        activeTab={activeTab}
        setActiveTab={(tab) => setActiveTab(tab as 'messages' | 'call')}
      >
        <Switch>
          <Match when={activeTab() === 'messages'}>
            <ActiveCallMessage channelId="channel-1" />
          </Match>
          <Match when={activeTab() === 'call'}>
            <div>Call controls</div>
          </Match>
        </Switch>
      </ChannelTabProvider>
    ));

    await userEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(screen.getByText('Call controls')).toBeTruthy();
  });
});
