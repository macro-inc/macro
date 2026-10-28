import { t } from '@app/lib/i18n';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel } from '@ui';
import { Show } from 'solid-js';
import { ItemFace } from '../components/conversation-card';
import { useBoard } from '../context/board-context';
import type { BoardItem } from '../core/item';

/**
 * An item opened from the board: its real content in a modal over the
 * board, so closing it lands back exactly where the viewer was.
 */
export function BoardModal(props: {
  item: BoardItem | undefined;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onDismiss: (key: string) => void;
  onOpenInSplit: (key: string, newSplit: boolean) => void;
}) {
  const board = useBoard();
  return (
    <Dialog
      open={props.item !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
      position="center"
      animate
      contentOwnsScroll
      class="w-[min(1040px,calc(100vw-48px))]"
    >
      <Show when={props.item}>
        {(item) => (
          <Panel
            depth={2}
            class="flex h-[min(82vh,900px)] flex-col overflow-hidden rounded-xl text-ink"
          >
            <Panel.Header class="gap-1 px-2">
              <Dialog.CloseButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                aria-label={t('board.close')}
              >
                <XIcon />
              </Dialog.CloseButton>
              <ItemFace item={item()} size={20} Avatar={board.Avatar} />
              <Dialog.Title
                as="span"
                class="m-0 min-w-0 flex-1 truncate p-0 text-sm font-medium"
              >
                {item().title}
              </Dialog.Title>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => props.onDismiss(item().key)}
              >
                <EyeSlashIcon />
                {t('board.remove')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) =>
                  props.onOpenInSplit(item().key, event.shiftKey)
                }
              >
                <ArrowSquareOutIcon />
                {t('board.openInSplit')}
              </Button>
            </Panel.Header>
            <div class="relative min-h-0 flex-1 overflow-hidden">
              <board.Detail itemKey={item().key} />
            </div>
          </Panel>
        )}
      </Show>
    </Dialog>
  );
}
