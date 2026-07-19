/**
 * @vitest-environment jsdom
 */

import type { Link } from '@service-email/generated/schemas';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailEntity, EntityData } from '../../types/entity';
import { EmailInboxChip, useOwningInboxForEntity } from './email';
import {
  EmailLinksProvider,
  EmailLinksQueryProvider,
  useEmailLinks,
} from './email-links-context';

const mocks = vi.hoisted(() => ({
  useEmailLinksQuery: vi.fn(),
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: mocks.useEmailLinksQuery,
}));

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

function LinksConsumer() {
  const links = useEmailLinks();
  return (
    <span>
      {links()
        .map((link) => link.id)
        .join(',')}
    </span>
  );
}

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

beforeEach(() => {
  mocks.useEmailLinksQuery.mockReset();
  mocks.useEmailLinksQuery.mockReturnValue({
    data: { links: [{ id: 'inbox-1' }] },
  });
});

describe('EmailLinksContext', () => {
  it('uses provided links without creating a query', () => {
    const links = (): Link[] => [{ id: 'provided-inbox' } as Link];

    render(() => (
      <EmailLinksProvider links={links}>
        <LinksConsumer />
      </EmailLinksProvider>
    ));

    expect(screen.getByText('provided-inbox')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).not.toHaveBeenCalled();
  });

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
    expect(mocks.useEmailLinksQuery).not.toHaveBeenCalled();
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

  it('makes standalone query ownership explicit', () => {
    render(() => (
      <EmailLinksQueryProvider>
        <LinksConsumer />
      </EmailLinksQueryProvider>
    ));

    expect(screen.getByText('inbox-1')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).toHaveBeenCalledOnce();
  });

  it('fails fast outside a provider', () => {
    expect(() => render(() => <LinksConsumer />)).toThrow(
      'useEmailLinks can only be used under an EmailLinksProvider'
    );
  });
});
