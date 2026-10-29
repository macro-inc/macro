import { EmailAttachmentIcon } from '@app/features/email-message/components/attachment-pill';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { useListLayout } from '@entity/composed/list-entity/shared';
import { formatTimestamp } from '@entity/utils/timestamp';
import CaretDownIcon from '@phosphor/caret-down.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import { Button, cn } from '@ui';
import type { JSX } from 'solid-js';
import type {
  EmailFileRow,
  EmailFilesToggleRow,
} from '../queries/email-search-files';

/** Lines Files rows up with the email rows and headings around them. */
function FilesSectionRow(props: {
  id: string;
  highlighted: boolean;
  onHover: () => void;
  onClick: (event: MouseEvent) => void;
  class?: string;
  'aria-expanded'?: boolean;
  children: JSX.Element;
}) {
  const listLayout = useListLayout();

  return (
    <div id={props.id} role="row">
      <div
        role="gridcell"
        aria-expanded={props['aria-expanded']}
        class={cn(
          (listLayout?.isWide() ?? true)
            ? SOUP_ROW_CLASS.wide
            : SOUP_ROW_CLASS.narrow,
          'group/file mx-(--soup-row-gutter) flex min-h-10 w-[calc(100%-2*var(--soup-row-gutter))] items-center gap-2 rounded-xl pr-2 text-sm touch:min-h-11',
          'pl-[calc(var(--soup-row-content-inset)-var(--soup-row-gutter))]',
          props.highlighted && !isTouchDevice()
            ? 'bg-list-highlighted'
            : 'not-touch:hover:bg-list-hover',
          props.class
        )}
        onMouseMove={() => props.onHover()}
        onClick={(event) => props.onClick(event)}
      >
        {props.children}
      </div>
    </div>
  );
}

export function EmailSearchFileRow(props: {
  row: EmailFileRow;
  highlighted: boolean;
  onHover: () => void;
  onOpen: (event: MouseEvent) => void;
  onOpenEmail: (event: MouseEvent) => void;
}) {
  const listLayout = useListLayout();
  const isWide = () => listLayout?.isWide() ?? true;
  const file = () => props.row.file;
  const origin = () => {
    const sentAt = file().sentAt;
    return [file().sender, sentAt && formatTimestamp(sentAt)]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <FilesSectionRow
      id={props.row.id}
      highlighted={props.highlighted}
      onHover={props.onHover}
      onClick={props.onOpen}
    >
      <span class="size-4 shrink-0">
        <EmailAttachmentIcon
          fileName={file().filename}
          mimeType={file().mimeType}
        />
      </span>
      {/* Narrow lists stack the origin under the name so the name stays readable. */}
      <span
        class={cn(
          'flex min-w-0 flex-1',
          isWide() ? 'items-center gap-2' : 'flex-col py-1'
        )}
      >
        <span class="ph-no-capture min-w-0 truncate font-medium text-ink">
          {file().filename}
        </span>
        <span
          class={cn(
            'ph-no-capture min-w-0 truncate text-ink-muted',
            isWide() ? 'ml-auto' : 'text-xs'
          )}
        >
          {origin()}
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        label="Open email"
        shortcut="shift+enter"
        data-file-action
        class={cn(
          'text-ink-extra-muted',
          !isTouchDevice() &&
            !props.highlighted &&
            'opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100'
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onFocus={() => props.onHover()}
        onClick={(event) => {
          event.stopPropagation();
          props.onOpenEmail(event);
        }}
      >
        <EnvelopeSimpleIcon class="size-4" />
      </Button>
    </FilesSectionRow>
  );
}

export function EmailSearchFilesToggle(props: {
  row: EmailFilesToggleRow;
  highlighted: boolean;
  onHover: () => void;
  onToggle: () => void;
}) {
  return (
    <FilesSectionRow
      id={props.row.id}
      highlighted={props.highlighted}
      onHover={props.onHover}
      onClick={() => props.onToggle()}
      aria-expanded={props.row.expanded}
      class="text-ink-muted"
    >
      <span class="grid size-4 shrink-0 place-items-center">
        <CaretDownIcon
          class={cn(
            'size-3 transition-transform motion-reduce:transition-none',
            props.row.expanded && 'rotate-180'
          )}
        />
      </span>
      {props.row.expanded
        ? 'Show fewer files'
        : `Show ${props.row.hiddenCount} more ${props.row.hiddenCount === 1 ? 'file' : 'files'}`}
    </FilesSectionRow>
  );
}
