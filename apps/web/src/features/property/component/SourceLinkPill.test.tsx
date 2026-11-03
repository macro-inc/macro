import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useProperty } from '../core/context';
import { Root } from '../core/Root';
import type { EntityProperty } from '../types';
import { SourceLinkPill } from './SourceLinkPill';

const openDocument = vi.hoisted(() => vi.fn());
vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument,
}));
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (
    _id: () => string,
    _type: () => string,
    options: { specificMessageId: () => string }
  ) => ({
    name: () => 'Planning',
    icon: () => null,
    blockOrFileType: () => 'channel',
    linkParams: () => ({ channel_message_id: options.specificMessageId() }),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

function EditorState() {
  const ctx = useProperty();
  return <output>{ctx.editorOpen() ? 'Editing' : 'Not editing'}</output>;
}

it('opens the current exact source without opening its picker', () => {
  const [property, setProperty] = createSignal(source);
  render(() => (
    <Root property={property()} canEdit>
      <SourceLinkPill property={property()} fallback={<span>Source</span>} />
      <EditorState />
    </Root>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open source Planning' }));
  expect(openDocument).toHaveBeenLastCalledWith(
    'channel',
    'channel',
    { channel_message_id: 'reply' },
    false
  );
  expect(screen.getByText('Not editing')).toBeTruthy();
  setProperty({
    ...source,
    value: [
      {
        entity_type: 'CHANNEL',
        entity_id: 'other-channel',
        specific_message_id: 'other-reply',
      },
    ],
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Open source Planning' }),
    { shiftKey: true }
  );
  expect(openDocument).toHaveBeenLastCalledWith(
    'channel',
    'other-channel',
    { channel_message_id: 'other-reply' },
    true
  );
});

it('opens the source picker from the caret without navigating away', () => {
  render(() => (
    <Root property={source} canEdit>
      <SourceLinkPill property={source} fallback={<span>Source</span>} />
      <EditorState />
    </Root>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Change source' }));
  expect(screen.getByText('Editing')).toBeTruthy();
  expect(openDocument).not.toHaveBeenCalled();
});
