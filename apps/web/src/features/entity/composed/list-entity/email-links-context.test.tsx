/**
 * @vitest-environment jsdom
 */

import type { Link } from '@service-email/generated/schemas';
import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
