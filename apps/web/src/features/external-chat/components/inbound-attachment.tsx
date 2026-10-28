import FileIcon from '@phosphor/file.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { Match, Show, Switch } from 'solid-js';
import type { InboundAttachment } from '../core/attachments';

/**
 * A file that doesn't play inline: once stored, a chip that opens it (like
 * a PDF from Chat), otherwise its placeholder.
 */
export function AttachmentChip(props: {
  attachment: InboundAttachment;
  url: (fileId: string) => string;
}) {
  const stored = () =>
    props.attachment.state === 'ready' ? props.attachment.fileId : undefined;
  return (
    <Show
      when={stored()}
      fallback={
        <InboundAttachmentPlaceholder
          state={
            props.attachment.state === 'ready'
              ? 'loading'
              : props.attachment.state
          }
          fileName={props.attachment.fileName}
        />
      }
    >
      {(fileId) => (
        <a
          href={props.url(fileId())}
          target="_blank"
          rel="noopener noreferrer"
          class="flex h-12 max-w-sm items-center gap-2 rounded-lg border border-edge-muted px-3 text-sm text-ink hover:bg-hover"
          data-linked-inbound-attachment="ready"
        >
          <FileIcon class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate">{props.attachment.fileName}</span>
        </a>
      )}
    </Show>
  );
}

/**
 * A WhatsApp file that isn't stored yet (still importing, failed, or of a
 * kind Macro can't keep), or one whose file can't be fetched. Every state is
 * the same height, so the channel doesn't jump when it resolves.
 */
export function InboundAttachmentPlaceholder(props: {
  state: 'loading' | 'unavailable' | 'unsupported';
  fileName: string;
}) {
  return (
    <div
      class="flex h-12 max-w-sm items-center gap-2 rounded-lg border border-edge-muted px-3 text-sm text-ink-muted"
      data-linked-inbound-attachment={props.state}
    >
      <Switch>
        <Match when={props.state === 'loading'}>
          <SpinnerIcon
            class="size-4 shrink-0 animate-spin"
            aria-hidden="true"
          />
          <span role="status" class="min-w-0 truncate">
            Loading {props.fileName}…
          </span>
        </Match>
        <Match when={props.state === 'unavailable'}>
          <WarningIcon class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate">
            Attachment unavailable: {props.fileName}
          </span>
        </Match>
        <Match when={props.state === 'unsupported'}>
          <WarningIcon class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate">
            {props.fileName} can't be shown in Macro
          </span>
        </Match>
      </Switch>
    </div>
  );
}
