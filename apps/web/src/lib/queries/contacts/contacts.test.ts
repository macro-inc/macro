import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useContacts } from './contacts';

const mocks = vi.hoisted(() => ({
  displayName: vi.fn((id: string) => `name of ${id}`),
}));

vi.mock('@core/user/util', () => ({
  idToDisplayName: mocks.displayName,
  idToEmail: (id: string) => id.replace('macro|', ''),
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@service-contacts/client', () => ({ contactsClient: {} }));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: () => ({
    isSuccess: true,
    data: { contacts: ['macro|ada@example.com', 'macro|bob@example.com'] },
  }),
}));

it('resolves contact names only once the list is read', () => {
  createRoot((dispose) => {
    const contacts = useContacts();
    expect(mocks.displayName).not.toHaveBeenCalled();

    expect(contacts()).toEqual([
      {
        id: 'macro|ada@example.com',
        email: 'ada@example.com',
        name: 'name of macro|ada@example.com',
      },
      {
        id: 'macro|bob@example.com',
        email: 'bob@example.com',
        name: 'name of macro|bob@example.com',
      },
    ]);
    expect(mocks.displayName).toHaveBeenCalledTimes(2);
    dispose();
  });
});
