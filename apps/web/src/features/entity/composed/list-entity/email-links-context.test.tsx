/**
 * @vitest-environment jsdom
 */

import type { Link } from '@service-email/generated/schemas';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { EmailEntity, EntityData } from '../../types/entity';
import { EmailInboxChip, useOwningInboxForEntity } from './email';
import { EmailLinksProvider } from './email-links-context';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span data-testid="inbox-icon" />,
}));

vi.mock('../../entity', () => ({ Entity: {} }));
vi.mock('../../components/Badges', () => ({ DraftBadge: () => null }));
vi.mock('../../extractors-search/HitSnippet', () => ({
  HitSnippet: () => null,
}));
vi.mock('../../extractors-search/snippet-entity', () => ({
  getSnippetHit: () => undefined,
}));

function RecycledRowInboxConsumer() {
  const [entity, setEntity] = createSignal<EntityData>({
    id: 'document-1',
    name: 'Document',
    ownerId: 'user-1',
    type: 'document',
  });
  const inbox = useOwningInboxForEntity(entity);

  return (
    <>
      <Show when={inbox()}>
        {(link) => <span>{link().email_address}</span>}
      </Show>
      <button
        type="button"
        onClick={() =>
          setEntity({
            id: 'thread-1',
            name: 'Email',
            ownerId: 'user-1',
            type: 'email',
            isRead: true,
            isDraft: false,
            isImportant: false,
            done: false,
            linkId: 'secondary-inbox',
          })
        }
      >
        Recycle row
      </button>
    </>
  );
}

describe('EmailLinksContext', () => {
  it('supports the real email-row consumer', () => {
    const links = (): Link[] => [
      { id: 'primary-inbox' } as Link,
      {
        id: 'secondary-inbox',
        email_address: 'secondary@example.com',
      } as Link,
    ];
    const entity = {
      type: 'email',
      linkId: 'secondary-inbox',
    } as EmailEntity;

    render(() => (
      <EmailLinksProvider links={links}>
        <EmailInboxChip entity={entity} />
      </EmailLinksProvider>
    ));

    expect(screen.getByTitle('secondary@example.com')).toBeTruthy();
  });

  it('updates inbox attribution when a mounted row changes entity type', async () => {
    const links = (): Link[] => [
      { id: 'primary-inbox' } as Link,
      {
        id: 'secondary-inbox',
        email_address: 'secondary@example.com',
      } as Link,
    ];

    render(() => (
      <EmailLinksProvider links={links}>
        <RecycledRowInboxConsumer />
      </EmailLinksProvider>
    ));

    expect(screen.queryByText('secondary@example.com')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Recycle row' }));
    expect(screen.getByText('secondary@example.com')).toBeTruthy();
  });
});
