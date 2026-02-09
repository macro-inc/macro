import { EntityIcon } from '@core/component/EntityIcon';
import X from '@icon/regular/x.svg';
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
  onClick?: (event: MouseEvent, fileType?: FileType) => void;
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
      class="items-center text-xs flex flex-row p-2 w-36 rounded border border-edge hover:bg-hover hover-transition-bg"
      classList={{
        'pl-2': props.removable,
      }}
      onClick={(e) => props.onClick?.(e, fileType())}
    >
      <Show when={fileType() !== undefined || props.attachment.mimeType}>
        <EntityIcon
          targetType={fileType() ?? (props.attachment.mimeType as FileType)}
          size="xs"
        />
      </Show>
      <div class="truncate ml-1">{props.attachment.fileName}</div>
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
            parentDiv.style.backgroundColor = 'var(--color-panel)';
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
