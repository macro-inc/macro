/**
 * @vitest-environment jsdom
 */

import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import type { MessageData } from '@core/messages/types';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SenderName } from '../SenderName';

// Live team-bot profiles need a query client; client posts never look one up.
vi.mock('@queries/bots/profiles', () => ({
  useLiveBotSender: (sender: () => unknown) => sender,
}));

afterEach(cleanup);

const clientPost = (
  triggered_via: string,
  triggered_via_kind: 'claude_code' | null
) =>
  ({
    id: 'message-1',
    content: 'hi',
    sender_id: MACRO_AGENT_PRINCIPAL_ID,
    sender: {
      type: 'bot',
      id: '00000000-0000-0000-0000-00000000a1a1',
      name: 'Macro',
      triggered_by: 'macro|alice@example.com',
      triggered_via,
      triggered_via_kind,
    },
  }) as unknown as MessageData;

describe('SenderName', () => {
  it('labels an unverified client and explains why', () => {
    const { container, getByText } = render(() => (
      <SenderName message={clientPost('Claude', null)} />
    ));
    expect(container.textContent).toBe('Claude (unverified app)');
    expect(getByText('(unverified app)').getAttribute('aria-description')).toBe(
      'This app named itself “Claude”. Macro can’t verify which app it is.'
    );
  });

  it('names a verified client bare', () => {
    const { container, queryByText } = render(() => (
      <SenderName message={clientPost('Claude Code', 'claude_code')} />
    ));
    expect(container.textContent).toBe('Claude Code');
    expect(queryByText('(unverified app)')).toBeNull();
  });
});
