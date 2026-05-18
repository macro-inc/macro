import { EntityIcon } from '@core/component/EntityIcon';
import X from '@icon/x.svg';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { Show } from 'solid-js';

const mimeToFileExtTypeMap = new Map<string, string>(
  Object.values(FileTypeMap).map((value) => [value.mime, value.extension])
);

type EmailAttachmentPillProps = {
  attachment: { fileName: string; mimeType?: string };
  removable?: boolean;
  onRemove?: () => void;
  onClick?: (fileType?: FileType) => void;
};

export function EmailAttachmentPill(props: EmailAttachmentPillProps) {
  let parentDiv!: HTMLDivElement;

  const fileType = () =>
    props.attachment.mimeType
      ? (mimeToFileExtTypeMap.get(props.attachment.mimeType) as FileType)
      : undefined;

  return (
    <div
      ref={parentDiv}
      class="items-center text-xs flex flex-row p-2 w-36 rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 hover:bg-ink-muted/6 cursor-pointer"
      classList={{
        'pl-2': props.removable,
      }}
      onClick={() => props.onClick?.(fileType())}
    >
      <Show when={fileType() !== undefined || props.attachment.mimeType}>
        <EntityIcon
          targetType={fileType() ?? (props.attachment.mimeType as FileType)}
          size="xs"
        />
      </Show>
      <div class="ph-no-capture truncate ml-1">{props.attachment.fileName}</div>
      <Show when={props.removable}>
        <div
          class="ml-auto p-2 hover:text-failure"
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
        </div>
      </Show>
    </div>
  );
}
