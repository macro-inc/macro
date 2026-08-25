/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAttachmentReferencesQuery: vi.fn(),
  queriedWith: vi.fn(),
}));

vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: mocks.useAttachmentReferencesQuery,
}));

// The list itself renders item previews over the network and needs the app's
// context tree; it has its own coverage. Stub it so these assertions are about
// what the section decides: whether to render, the count it reports, and the
// entity it forwards.
vi.mock('./References', () => ({
  References: (props: { documentId: string; entityType?: string }) => (
    <div
      data-testid="list"
      data-entity={`${props.entityType}:${props.documentId}`}
    />
  ),
}));

// Panel chrome is flattened; SidePanel has its own coverage.
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Section: (props: ParentProps<{ title: JSX.Element }>) => (
      <section data-testid="section">
        <h2>{props.title}</h2>
        {props.children}
      </section>
    ),
    CountTitle: (props: { label: JSX.Element; count: number }) => (
      <>
        {props.label} ({props.count})
      </>
    ),
    Loading: () => <div>loading</div>,
  },
}));

import { EntityReferencesSection } from './EntityReferencesSection';

function mockReferenceCount(count: number) {
  mocks.useAttachmentReferencesQuery.mockImplementation(
    (entityId: () => string, entityType: () => string) => {
      mocks.queriedWith({ entityId: entityId(), entityType: entityType() });
      return {
        data: Array.from({ length: count }, (_, i) => ({ id: `${i}` })),
      };
    }
  );
}

describe('EntityReferencesSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing while the entity has no references', () => {
    mockReferenceCount(0);
    render(() => (
      <EntityReferencesSection entityId="company-1" entityType="crm_company" />
    ));
    expect(screen.queryByTestId('section')).toBeNull();
  });

  it('renders a counted section once the entity has references', () => {
    mockReferenceCount(2);
    render(() => (
      <EntityReferencesSection entityId="company-1" entityType="crm_company" />
    ));
    expect(screen.getByRole('heading').textContent).toBe('References (2)');
    expect(screen.getByTestId('list').dataset.entity).toBe(
      'crm_company:company-1'
    );
  });

  it('queries and forwards the entity type it was given', () => {
    mockReferenceCount(1);
    render(() => (
      <EntityReferencesSection entityId="contact-7" entityType="crm_contact" />
    ));
    expect(mocks.queriedWith).toHaveBeenCalledWith({
      entityId: 'contact-7',
      entityType: 'crm_contact',
    });
  });

  it('falls back to the document entity type', () => {
    mockReferenceCount(1);
    render(() => <EntityReferencesSection entityId="doc-3" />);
    expect(mocks.queriedWith).toHaveBeenCalledWith({
      entityId: 'doc-3',
      entityType: 'document',
    });
  });
});
