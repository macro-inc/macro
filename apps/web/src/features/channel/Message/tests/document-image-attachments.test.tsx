// Agents attach the images they make as documents. Mocks stop at the item
// preview and document URL queries; Attachments and the partition run as
// written.
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Attachments } from '../Attachments';

const fileTypes: Record<string, string> = {
  'chart-doc': 'png',
  'report-doc': 'pdf',
};

vi.mock('@queries/preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/preview')>()),
  useItemPreview: (item: () => { id: string }) => [
    () => ({
      id: item().id,
      type: 'document',
      access: 'access',
      loading: false,
      fileType: fileTypes[item().id],
    }),
  ],
}));
vi.mock('@queries/storage/binary-document', () => ({
  useBinaryDocumentQuery: (id: () => string) => ({
    get isSuccess() {
      return id() !== '';
    },
    get data() {
      return `https://storage.test/${id()}?signature=abc`;
    },
  }),
}));
vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type: string }) => (
    <span>
      Chip {props.type} {props.id}
    </span>
  ),
}));
vi.mock('../MediaPreview', () => ({
  MediaPreview: (props: { items: { id: string; src: string }[] }) => (
    <ul>
      <For each={props.items}>
        {(item) => (
          <li>
            Inline {item.id} {item.src}
          </li>
        )}
      </For>
    </ul>
  ),
}));
vi.mock('../context', () => ({
  useMessage: () => () => ({
    attachments: [
      { entity_type: 'document', entity_id: 'chart-doc' },
      { entity_type: 'document', entity_id: 'report-doc' },
    ],
  }),
}));
afterEach(cleanup);

it('previews an attached image document inline and keeps its chip', () => {
  render(() => <Attachments />);

  expect(
    screen.getByText(
      'Inline chart-doc https://storage.test/chart-doc?signature=abc'
    )
  ).toBeTruthy();
  expect(screen.getByText('Chip document chart-doc')).toBeTruthy();
  expect(screen.getByText('Chip document report-doc')).toBeTruthy();
  expect(screen.queryByText(/Inline report-doc/)).toBeNull();
});
