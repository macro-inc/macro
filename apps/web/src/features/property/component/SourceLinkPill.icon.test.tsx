import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Root } from '../core/Root';
import type { EntityProperty } from '../types';
import { SourceLinkPill } from './SourceLinkPill';

vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@core/context/channels', () => ({
  useChannelName: () => () => 'Planning',
}));
vi.mock('../hooks/usePropertyUserDisplay', () => ({
  usePropertyUserDisplay: () => ({ name: () => '', photoUrl: () => undefined }),
}));
vi.mock('@queries/preview', () => ({
  useItemPreview: () => [
    () => ({
      loading: false,
      access: 'access',
      name: 'Planning',
      fileType: 'md',
    }),
  ],
  isAccessiblePreviewItem: (item: { access?: string }) =>
    item.access === 'access',
}));

afterEach(cleanup);

const source: EntityProperty = {
  propertyId: 'source',
  propertyDefinitionId: 'source-definition',
  displayName: 'Source',
  valueType: 'ENTITY',
  isMultiSelect: false,
  value: [
    {
      entity_type: 'CHANNEL',
      entity_id: 'channel',
      specific_message_id: 'reply',
    },
  ],
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
};

it('keeps the real item icon mounted when a source reference changes', () => {
  const [property, setProperty] = createSignal(source);
  render(() => (
    <Root property={property()} canEdit>
      <SourceLinkPill property={property()} fallback={<span>Source</span>} />
    </Root>
  ));
  const button = () =>
    screen.getByRole('button', { name: 'Open source Planning' });
  expect(
    button().querySelector('[data-macro-icon="hash-straight"]')
  ).not.toBeNull();
  setProperty({
    ...source,
    value: [
      {
        entity_type: 'THREAD',
        entity_id: 'email',
        specific_message_id: 'email-message',
      },
    ],
  });
  expect(button().querySelector('[data-macro-icon="envelope"]')).not.toBeNull();
  expect(
    button().querySelector('[data-macro-icon="hash-straight"]')
  ).toBeNull();
});
