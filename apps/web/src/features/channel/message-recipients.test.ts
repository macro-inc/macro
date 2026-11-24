import type { CombinedRecipientItem } from '@core/user';
import type { RecipientSourceInput } from '@core/user/recipient-source';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  createMessageRecipients,
  type MessageRecipient,
} from './message-recipients';

const person = {
  kind: 'user',
  id: 'macro|person@example.com',
  data: { id: 'macro|person@example.com' },
} as unknown as CombinedRecipientItem<'user'>;
const channel = {
  kind: 'channel',
  id: 'channel-1',
  data: { id: 'channel-1', name: 'design' },
} as unknown as CombinedRecipientItem<'channel'>;

vi.mock('@queries/contacts/recipient-source', () => ({
  useCombinedRecipientSource: () => ({
    items: () => [person, channel],
    loading: () => false,
    error: () => null,
    incomplete: () => false,
    hasNext: () => false,
    windowKey: () => undefined,
    next: async () => {},
    retry: async () => {},
  }),
}));

function withRecipients(
  test: (r: ReturnType<typeof createMessageRecipients>) => void
) {
  createRoot((dispose) => {
    test(createMessageRecipients());
    dispose();
  });
}

const sourceInput: RecipientSourceInput = {
  search: () => '',
  enabled: () => true,
  selfId: () => undefined,
  senderDomain: () => undefined,
  includeSelf: () => false,
};

describe('message recipients', () => {
  it('offers channels only while nothing is picked', () => {
    withRecipients((recipients) => {
      const source = recipients.createSource(sourceInput);
      expect(source.items().map((item) => item.kind)).toEqual([
        'user',
        'channel',
      ]);

      recipients.select([person as MessageRecipient]);

      expect(source.items().map((item) => item.kind)).toEqual(['user']);
      expect(recipients.isFull()).toBe(false);

      recipients.select([]);
      expect(source.items().map((item) => item.kind)).toEqual([
        'user',
        'channel',
      ]);
    });
  });

  it('fills the field with a picked channel until it is removed', () => {
    withRecipients((recipients) => {
      recipients.select([channel as MessageRecipient]);
      expect(recipients.selectedChannel()?.id).toBe('channel-1');
      expect(recipients.isFull()).toBe(true);

      recipients.select([]);
      expect(recipients.isFull()).toBe(false);
    });
  });
});
