import { t } from '@app/lib/i18n';
import { type EntityData, EntitySelectionToolbar } from '@entity';
import ShareIcon from '@icon/share.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export type DriveSelectionToolbarProps = {
  selected: EntityData[];
  canTrash: boolean;
  allStarred: boolean;
  onClear: () => void;
  onMove: () => void;
  onToggleStar: () => void;
  onShare: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
};

/**
 * Floating multi-select action bar wrapping Macro's EntitySelectionToolbar
 * with direct one-click Drive actions alongside Actions (⌘K) and Clear (Esc).
 */
export function DriveSelectionToolbar(props: DriveSelectionToolbarProps) {
  return (
    <Show when={props.selected.length > 0}>
      <EntitySelectionToolbar
        selected={props.selected}
        onClear={props.onClear}
        analyticsSource="drive_redesign_selection_toolbar"
      >
        <Button
          variant="secondary"
          size="sm"
          class="bg-surface"
          onClick={props.onMove}
        >
          <FolderIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('drive.move')}</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="bg-surface"
          onClick={props.onToggleStar}
        >
          <StarIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{props.allStarred ? t('drive.unstar') : t('drive.star')}</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="bg-surface"
          onClick={props.onShare}
        >
          <ShareIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('drive.share')}</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="bg-surface"
          onClick={props.onDuplicate}
        >
          <CopyIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('drive.duplicate')}</span>
        </Button>
        <Show when={props.canTrash}>
          <Button
            variant="secondary"
            size="sm"
            class="bg-surface text-failure-ink hover:text-failure-ink"
            onClick={props.onTrash}
          >
            <TrashIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t('drive.moveToTrash')}</span>
          </Button>
        </Show>
      </EntitySelectionToolbar>
    </Show>
  );
}
