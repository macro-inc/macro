import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { Attachments } from './Attachments';

vi.mock('@app/features/projects/project-attachment', () => ({
  ProjectAttachment: (props: { id: string }) => (
    <span>Native project {props.id}</span>
  ),
}));
vi.mock('@app/features/block-pr/component/PullRequestAttachment', () => ({
  PullRequestAttachment: (props: { id: string }) => (
    <span>Pull request {props.id}</span>
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
  stringToItemType: (type: string) =>
    type === 'foreign' || type === 'foreign_entity' ? 'foreign' : type,
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
      { entity_type: 'foreign_entity', entity_id: 'pr-1' },
      { entity_type: 'foreign', entity_id: 'pr-2' },
    ],
  }),
}));
afterEach(cleanup);

it('routes initiative and pull request attachments to their own previews', () => {
  render(() => <Attachments />);
  expect(screen.getByText('Native project launch')).toBeTruthy();
  expect(screen.getByText('Existing document note')).toBeTruthy();
  expect(screen.getByText('Existing project folder')).toBeTruthy();
  expect(screen.getByText('Pull request pr-1')).toBeTruthy();
  expect(screen.getByText('Pull request pr-2')).toBeTruthy();
  expect(screen.queryByText('Existing initiative launch')).toBeNull();
  expect(screen.queryByText('Existing foreign pr-1')).toBeNull();
  expect(screen.queryByText('Existing foreign_entity pr-1')).toBeNull();
});
