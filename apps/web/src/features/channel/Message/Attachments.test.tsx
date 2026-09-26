import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { Attachments } from './Attachments';

vi.mock('@app/features/projects/project-attachment', () => ({
  ProjectAttachment: (props: { id: string }) => (
    <span>Native project {props.id}</span>
  ),
}));
vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type: string }) => (
    <span>
      Existing {props.type} {props.id}
    </span>
  ),
}));
vi.mock('@service-storage/client', () => ({
  stringToItemType: (type: string) => type,
}));
vi.mock('@channel/Media/media-items', () => ({
  partitionAttachments: (attachments: unknown[]) => ({
    mediaAttachments: [],
    documentAttachments: attachments,
  }),
  mapMediaItems: () => [],
}));
vi.mock('./MediaPreview', () => ({ MediaPreview: () => null }));
vi.mock('@ui', () => ({ cn: () => '' }));
vi.mock('./context', () => ({
  useMessage: () => () => ({
    attachments: [
      { entity_type: 'initiative', entity_id: 'launch' },
      { entity_type: 'document', entity_id: 'note' },
      { entity_type: 'project', entity_id: 'folder' },
    ],
  }),
}));
afterEach(cleanup);

it('routes only initiative attachments to the native project preview', () => {
  render(() => <Attachments />);
  expect(screen.getByText('Native project launch')).toBeTruthy();
  expect(screen.getByText('Existing document note')).toBeTruthy();
  expect(screen.getByText('Existing project folder')).toBeTruthy();
  expect(screen.queryByText('Existing initiative launch')).toBeNull();
});
