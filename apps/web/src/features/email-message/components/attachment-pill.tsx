import { EntityIcon } from '@core/component/EntityIcon';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import X from '@icon/system/regular/x.svg';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import { Tooltip } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { isCalendarFile } from '../core/email-message';

const mimeToFileExtTypeMap = new Map<string, string>(
  Object.values(FileTypeMap).map((value) => [value.mime, value.extension])
);

type EmailAttachmentPillProps = {
  attachment: { fileName: string; mimeType?: string };
  removable?: boolean;
  onRemove?: () => void;
  /** Receives the chip, so a dialog it opens can return focus to it. */
  onClick?: (chip: HTMLElement) => void;
  /** Saves the file without opening it. Renders as the chip's split segment. */
  onDownload?: () => void;
};

export function EmailAttachmentPill(props: EmailAttachmentPillProps) {
  let parentDiv!: HTMLDivElement;

  const fileType = () => {
    if (isCalendarFile(props.attachment.fileName, props.attachment.mimeType)) {
      return 'ics';
    }
    const mimeType = props.attachment.mimeType
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    return mimeType ? mimeToFileExtTypeMap.get(mimeType) : undefined;
  };

  const downloadLabel = () => `Download ${props.attachment.fileName}`;

  return (
    <div
      ref={parentDiv}
      class="text-xs flex flex-row rounded-lg border border-ink-muted/8 bg-ink-muted/2.5"
      classList={{
        'items-center': !props.onDownload,
        'p-2': !props.onDownload,
        'w-36': !props.onDownload,
        'hover:bg-ink-muted/6': !props.onDownload,
        'pl-2': props.removable && !props.onDownload,
        'items-stretch': !!props.onDownload,
        'overflow-hidden': !!props.onDownload,
      }}
    >
      <Dynamic
        component={props.onClick ? 'button' : 'div'}
        type={props.onClick ? 'button' : undefined}
        data-button=""
        class="flex min-w-0 flex-1 items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-focus"
        classList={{
          'w-36': !!props.onDownload,
          'p-2': !!props.onDownload,
          'hover:bg-ink-muted/6': !!props.onDownload,
        }}
        onClick={(event: MouseEvent) => {
          if (event.currentTarget instanceof HTMLElement) {
            props.onClick?.(event.currentTarget);
          }
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        }}
      >
        <Show when={fileType() !== undefined || props.attachment.mimeType}>
          <EntityIcon targetType={fileType()} size="xs" />
        </Show>
        <span class="ph-no-capture truncate ml-1">
          {props.attachment.fileName}
        </span>
      </Dynamic>
      <Show when={props.onDownload}>
        <div class="w-px self-stretch bg-edge-divider" />
        <Tooltip
          label={downloadLabel()}
          class="flex items-stretch self-stretch"
        >
          <button
            type="button"
            data-button=""
            aria-label={downloadLabel()}
            class="flex w-8 shrink-0 items-center justify-center hover:bg-ink-muted/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-focus"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onDownload?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
          >
            <DownloadSimple width="16" height="16" />
          </button>
        </Tooltip>
      </Show>
      <Show when={props.removable}>
        <button
          type="button"
          data-button=""
          aria-label={`Remove ${props.attachment.fileName}`}
          class="ml-auto p-2 hover:text-failure"
          onPointerDown={(e) => {
            // Keep the editor's focus. Focusing its message card can scroll
            // this control away between pointerdown and click.
            e.preventDefault();
          }}
          onMouseDown={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          onclick={(e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            if (props.onRemove) props.onRemove();
          }}
          onPointerEnter={() => {
            parentDiv.style.backgroundColor = 'var(--color-surface)';
          }}
          onPointerLeave={() => {
            parentDiv.style.backgroundColor = '';
          }}
        >
          <X width="14" />
        </button>
      </Show>
    </div>
  );
}
