import { AttachmentChip } from '@channel/Message/AttachmentChip';
import { UserIcon } from '@core/component/UserIcon';
import { formatTimestamp } from '@entity/utils/timestamp';
import type { ApiChannelAttachment } from '@service-storage/generated/schemas/apiChannelAttachment';

/**
 * An attachment Soup did not return, shown as its message shows it. The chip's
 * border and padding sit in the row's left inset, so its icon lines up with the
 * entity rows' icons, and its box with the Projects section's chips.
 */
export function AttachmentChipRow(props: { attachment: ApiChannelAttachment }) {
  return (
    <div class="flex items-center gap-2 min-h-10 pl-4 pr-6 text-sm w-full">
      <div class="flex-1 min-w-0">
        <AttachmentChip
          attachment={props.attachment}
          previewClass="w-fit max-w-full"
        />
      </div>
      <div class="shrink-0">
        <UserIcon
          id={props.attachment.sender_id}
          size="sm"
          suppressClick
          showTooltip
        />
      </div>
      <span class="text-xs text-ink-extra-muted font-light shrink-0">
        {formatTimestamp(props.attachment.created_at)}
      </span>
    </div>
  );
}
