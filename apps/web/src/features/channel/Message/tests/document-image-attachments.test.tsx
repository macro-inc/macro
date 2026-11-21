// Agents attach the images they make as documents. Mocks stop at the item
// preview and document URL queries; Attachments and the partition run as
// written.
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Attachments } from '../Attachments';

const message = vi.hoisted(() => ({ content: '' }));

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
// Each refetch signs a new URL, as storage does.
vi.mock('@queries/storage/binary-document', async () => {
  const { createSignal } = await import('solid-js');
  return {
    fetchBinaryDocumentBlob: async () => undefined,
    useBinaryDocumentQuery: (id: () => string) => {
      const [signature, setSignature] = createSignal(1);
      return {
        get isSuccess() {
          return id() !== '';
        },
        get data() {
          return `https://storage.test/${id()}?signature=${signature()}`;
        },
        refetch: async () => setSignature(signature() + 1),
      };
    },
  };
});
vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type: string }) => (
    <span>
      Chip {props.type} {props.id}
    </span>
  ),
}));
vi.mock('../MediaPreview', () => ({
  MediaPreview: (props: {
    items: { id: string; src: string }[];
    onError?: (id: string) => void;
    onLoad?: (id: string) => void;
  }) => (
    <ul>
      <For each={props.items}>
        {(item) => (
          <li>
            Inline {item.id} {item.src}
            <button type="button" onClick={() => props.onLoad?.(item.id)}>
              Load {item.id}
            </button>
            <button type="button" onClick={() => props.onError?.(item.id)}>
              Fail {item.id}
            </button>
          </li>
        )}
      </For>
    </ul>
  ),
}));
vi.mock('../context', () => ({
  useMessage: () => () => ({
    sender_id: 'macro|person@example.com',
    content: message.content,
    attachments: [
      { entity_type: 'document', entity_id: 'chart-doc' },
      { entity_type: 'document', entity_id: 'report-doc' },
    ],
  }),
}));
afterEach(() => {
  cleanup();
  message.content = '';
});

it('previews an attached image document inline and keeps its chip', () => {
  render(() => <Attachments />);

  expect(
    screen.getByText(
      'Inline chart-doc https://storage.test/chart-doc?signature=1'
    )
  ).toBeTruthy();
  expect(screen.getByText('Chip document chart-doc')).toBeTruthy();
  expect(screen.getByText('Chip document report-doc')).toBeTruthy();
  expect(screen.queryByText(/Inline report-doc/)).toBeNull();
});

it('moves to a fresh URL once when the image fails, then falls back to the chip', async () => {
  render(() => <Attachments />);

  fireEvent.click(screen.getByText('Fail chart-doc'));
  expect(
    await screen.findByText(
      'Inline chart-doc https://storage.test/chart-doc?signature=2'
    )
  ).toBeTruthy();

  fireEvent.click(screen.getByText('Fail chart-doc'));
  expect(screen.queryByText(/Inline chart-doc/)).toBeNull();
  expect(screen.getByText('Chip document chart-doc')).toBeTruthy();
});

it('refreshes an image again when a URL that loaded expires later', async () => {
  render(() => <Attachments />);

  fireEvent.click(screen.getByText('Fail chart-doc'));
  await screen.findByText(
    'Inline chart-doc https://storage.test/chart-doc?signature=2'
  );
  fireEvent.click(screen.getByText('Load chart-doc'));

  fireEvent.click(screen.getByText('Fail chart-doc'));
  expect(
    await screen.findByText(
      'Inline chart-doc https://storage.test/chart-doc?signature=3'
    )
  ).toBeTruthy();

  fireEvent.click(screen.getByText('Fail chart-doc'));
  expect(screen.queryByText(/Inline chart-doc/)).toBeNull();
  expect(screen.getByText('Chip document chart-doc')).toBeTruthy();
});

it('leaves an image the text mentions to the mention preview', () => {
  message.content =
    'Chart: <m-document-mention>{"documentId":"chart-doc","documentName":"chart.png","blockName":"image"}</m-document-mention>';
  render(() => <Attachments />);

  expect(screen.queryByText(/Inline chart-doc/)).toBeNull();
  expect(screen.getByText('Chip document chart-doc')).toBeTruthy();
});
