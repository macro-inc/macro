import type {
  ContactReferencePerson,
  ContactReferenceRequest,
} from '@queries/contacts/references';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { fieldsSchema, type Intent } from '../core/input';
import { useInputPeople } from './input-people';

const references = vi.hoisted(() => ({
  request: undefined as
    | Accessor<Omit<ContactReferenceRequest, 'secondaryInboxIds'>>
    | undefined,
  lookup:
    vi.fn<(term: string) => readonly ContactReferencePerson[] | undefined>(),
}));
vi.mock('@queries/contacts/use-references', () => ({
  useContactReferences: (
    request: Accessor<Omit<ContactReferenceRequest, 'secondaryInboxIds'>>
  ) => {
    references.request = request;
    return {
      lookup: references.lookup,
      loading: () => false,
      error: () => null,
      retry: async () => {},
    };
  },
}));

it('keeps inference evidence per term and replaces only the active reference inputs', () => {
  createRoot((dispose) => {
    try {
      const [fields, setFields] = createSignal(
        fieldsSchema.parse({
          recipients: 'channel-id, @Person One',
          cc: 'Copy Person',
          guests: 'Guest Person',
        })
      );
      const [intent, setIntent] = createSignal<Intent | undefined>('message');
      const source = useInputPeople(fields, intent, () => [
        { id: 'channel-id', label: 'Channel', kind: 'channel' },
      ]);
      expect(references.request?.()).toEqual({
        labels: ['person one'],
        matching: 'preferFullName',
        excludeSecondaryInboxes: true,
      });
      const labels = references.request?.().labels;
      setFields((old) => ({ ...old, body: 'Changed body only' }));
      expect(references.request?.().labels).toBe(labels);
      references.lookup.mockImplementation((term) =>
        term === 'person one'
          ? [
              {
                userId: 'macro|one@example.com',
                email: 'one@example.com',
                name: 'Person One',
              },
            ]
          : undefined
      );
      expect(source.lookup('person one')).toEqual([
        {
          id: 'macro|one@example.com',
          email: 'one@example.com',
          label: 'Person One',
          kind: 'user',
        },
      ]);
      expect(source.lookup('Person')).toBeUndefined();
      expect(source.destinations('channel-id')).toEqual([
        { id: 'channel-id', label: 'Channel', kind: 'channel' },
      ]);
      setIntent('calendar');
      expect(references.request?.().labels).toEqual(['guest person']);
      setIntent('ai');
      expect(references.request?.().labels).toEqual([]);
    } finally {
      dispose();
      references.lookup.mockReset();
    }
  });
});
