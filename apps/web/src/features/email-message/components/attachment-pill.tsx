import { EntityIcon } from '@core/component/EntityIcon';
import X from '@icon/system/regular/x.svg';
import { FileTypeMap } from '@service-storage/fileTypeMap';
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
};

/** The file-type icon for an attachment; unknown types get the generic file icon. */
export function EmailAttachmentIcon(props: {
  fileName: string;
  mimeType?: string;
}) {
  const fileType = () => {
    if (isCalendarFile(props.fileName, props.mimeType)) {
      return 'ics';
    }
    const mimeType = props.mimeType?.split(';')[0].trim().toLowerCase();
    return mimeType ? mimeToFileExtTypeMap.get(mimeType) : undefined;
  };

  return <EntityIcon targetType={fileType()} size="xs" />;
}

export function EmailAttachmentPill(props: EmailAttachmentPillProps) {
  let parentDiv!: HTMLDivElement;

  return (
    <div
      ref={parentDiv}
      class="items-center text-xs flex flex-row p-2 w-36 rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 hover:bg-ink-muted/6"
      classList={{
        'pl-2': props.removable,
      }}
    >
      <Dynamic
        component={props.onClick ? 'button' : 'div'}
        type={props.onClick ? 'button' : undefined}
        class="flex min-w-0 flex-1 items-center text-left"
        onClick={(event: MouseEvent) => {
          if (event.currentTarget instanceof HTMLElement) {
            props.onClick?.(event.currentTarget);
          }
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        }}
      >
        <Show
          when={
            props.attachment.mimeType ||
            isCalendarFile(props.attachment.fileName, props.attachment.mimeType)
          }
        >
          <EmailAttachmentIcon
            fileName={props.attachment.fileName}
            mimeType={props.attachment.mimeType}
          />
        </Show>
        <span class="ph-no-capture truncate ml-1">
          {props.attachment.fileName}
        </span>
      </Dynamic>
      <Show when={props.removable}>
        <button
          type="button"
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
