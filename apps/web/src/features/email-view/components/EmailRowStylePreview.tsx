import { t } from '@app/lib/i18n';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import {
  type EmailEntity,
  type EmailRowStyle,
  ListEntity,
  ListEntityNoopMetadataProvider,
  ListLayoutProvider,
} from '@entity';
import { cn } from '@ui';
import { createSignal, For } from 'solid-js';

type SampleThread = {
  id: string;
  sender: () => string;
  subject: () => string;
  snippet: () => string;
  isRead: boolean;
  hoursAgo: number;
};

const SAMPLE_THREADS: SampleThread[] = [
  {
    id: 'unread',
    sender: () => t('settingsEmail.previewUnreadSender'),
    subject: () => t('settingsEmail.previewUnreadSubject'),
    snippet: () => t('settingsEmail.previewUnreadSnippet'),
    isRead: false,
    hoursAgo: 1,
  },
  {
    id: 'read',
    sender: () => t('settingsEmail.previewReadSender'),
    subject: () => t('settingsEmail.previewReadSubject'),
    snippet: () => t('settingsEmail.previewReadSnippet'),
    isRead: true,
    hoursAgo: 3,
  },
];

function sampleEntity(thread: SampleThread, now: number): EmailEntity {
  const at = new Date(now - thread.hoursAgo * 60 * 60 * 1000).toISOString();
  const email = `${thread.id}@example.test`;
  return {
    type: 'email',
    id: `email-row-style-preview-${thread.id}`,
    name: thread.subject(),
    ownerId: '',
    isRead: thread.isRead,
    isDraft: false,
    isImportant: false,
    done: false,
    snippet: thread.snippet(),
    senderEmail: email,
    senderName: thread.sender(),
    participants: [{ email, name: thread.sender() }],
    sortTs: at,
    updatedAt: at,
  };
}

/**
 * A few made-up Mail rows in the given row style, drawn by the real
 * `ListEntity` so the sample matches the list. It is a picture: inert, with
 * no selection or opening, and out of the accessibility tree, so the setting
 * describes the styles to screen readers itself.
 */
export function EmailRowStylePreview(props: {
  rowStyle: EmailRowStyle;
  class?: string;
}) {
  const [frame, setFrame] = createSignal<HTMLElement>();
  const now = Date.now();
  const entities = () =>
    SAMPLE_THREADS.map((thread) => sampleEntity(thread, now));

  return (
    <div
      ref={setFrame}
      inert
      data-email-row-style-preview={props.rowStyle}
      class={cn(
        'soup-list overflow-hidden rounded-lg bg-panel text-ink select-none',
        // The settings card restyles these for its own controls and rows;
        // the sample takes Mail's list values back.
        '[--color-control:var(--color-list-control)] [--color-edge-divider:var(--color-list-divider)]',
        props.class
      )}
    >
      <ListLayoutProvider ref={frame} narrowLayout="inbox">
        <ListEntityNoopMetadataProvider>
          {/* Touch rows sit on Mail's swipe surface; these never swipe. */}
          <SwipableRowProvider
            container={frame}
            canSwipeLeft={() => false}
            canSwipeRight={() => false}
          >
            <For each={entities()}>
              {(entity, index) => (
                <ListEntity
                  entity={entity}
                  rowStyle={props.rowStyle}
                  isFirstInGroup={index() === 0}
                />
              )}
            </For>
          </SwipableRowProvider>
        </ListEntityNoopMetadataProvider>
      </ListLayoutProvider>
    </div>
  );
}
