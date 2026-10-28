import './board.css';
import { ViewShell } from '@app/components/view-shell';
import { useViewTabHotkeys } from '@app/components/view-shell/use-view-tab-hotkeys';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Button } from '@ui';
import { type Component, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useBoard } from '../context/board-context';
import {
  BOARD_VARIANTS,
  type BoardVariant,
  variantCode,
} from '../core/variants';
import { createBoardMemory } from '../primitives/board-memory';
import { createBoardScene } from '../primitives/board-scene';
import { BoardModal } from './board-modal';
import { BoardSidebar, variantDescription, variantName } from './board-sidebar';
import { BubblesBoard } from './bubbles-board';
import { NeighborhoodsBoard } from './neighborhoods-board';
import { PeopleBoard } from './people-board';
import { RadarBoard } from './radar-board';
import { RiverBoard } from './river-board';
import type { VariantProps } from './variant-shared';

/** Every variant's board; a new id fails to type-check until it has one. */
const VARIANT_VIEWS: Record<BoardVariant, Component<VariantProps>> = {
  v1a: NeighborhoodsBoard,
  v1b: BubblesBoard,
  v1c: RiverBoard,
  v1d: RadarBoard,
  v1e: PeopleBoard,
};

/**
 * The company board: a variant picker beside a pannable, zoomable board of
 * what is happening. Opening an item shows it in a modal over the board;
 * the host owns which variant is selected.
 */
export function BoardView(props: {
  variant: BoardVariant;
  onVariantChange: (variant: BoardVariant) => void;
  /** Number keys and Tab cycle variants while this scope is active. */
  hotkeys?: { scopeId: string; enabled: () => boolean };
}) {
  const board = useBoard();
  const memory = createBoardMemory(board.storage);
  const scene = createBoardScene(board, memory);
  const [openKey, setOpenKey] = createSignal<string>();
  // A modal dialog returns focus to its trigger, and this one opens from
  // board state, so it hands focus back to whatever opened it.
  let opener: HTMLElement | undefined;

  const closeModal = () => {
    const key = openKey();
    setOpenKey(undefined);
    if (key) board.close(key);
  };

  const step = (offset: 1 | -1) => {
    const index = BOARD_VARIANTS.indexOf(props.variant);
    const next =
      BOARD_VARIANTS[
        (index + offset + BOARD_VARIANTS.length) % BOARD_VARIANTS.length
      ];
    props.onVariantChange(next);
  };

  if (props.hotkeys) {
    const hotkeys = props.hotkeys;
    useViewTabHotkeys({
      scopeId: hotkeys.scopeId,
      enabled: hotkeys.enabled,
      ids: () => BOARD_VARIANTS,
      activeId: () => props.variant,
      setActiveId: props.onVariantChange,
    });
  }

  const variantProps: VariantProps = {
    scene,
    memory,
    onOpen: (key) => {
      // Before marking it seen, which can re-render what was clicked.
      const active = document.activeElement;
      memory.markSeen(key, board.now());
      if (board.open(key) !== 'modal') return;
      opener = active instanceof HTMLElement ? active : undefined;
      setOpenKey(key);
    },
    onDismiss: (key, activityAt) => {
      memory.dismiss(key, activityAt);
      if (openKey() === key) closeModal();
    },
    onRetry: () => board.source.retry(),
  };

  const openItem = () => {
    const key = openKey();
    return key === undefined ? undefined : scene.item(key);
  };

  return (
    <>
      <ViewShell.Root asidePreferenceKey="board" resizable>
        <ViewShell.Aside>
          <BoardSidebar
            variant={props.variant}
            onVariantChange={props.onVariantChange}
            scene={scene}
            memory={memory}
          />
        </ViewShell.Aside>
        <ViewShell.Main class="flex flex-col overflow-hidden">
          <ViewShell.TopBar>
            <div class="flex min-w-0 flex-1 items-baseline gap-2">
              <h1 class="shrink-0 text-sm font-semibold tracking-[-0.03em] text-ink">
                {variantName(props.variant)}
              </h1>
              <span class="shrink-0 font-mono text-[11px] text-ink-extra-muted">
                {variantCode(props.variant)}
              </span>
              <span class="min-w-0 truncate text-xs text-ink-muted">
                {variantDescription(props.variant)}
              </span>
            </div>
            <HeaderActionGroup label={t('board.variants')}>
              <Button
                variant="ghost"
                size="icon-md"
                label={variantName(
                  BOARD_VARIANTS[
                    (BOARD_VARIANTS.indexOf(props.variant) +
                      BOARD_VARIANTS.length -
                      1) %
                      BOARD_VARIANTS.length
                  ]
                )}
                onClick={() => step(-1)}
              >
                <CaretLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-md"
                label={variantName(
                  BOARD_VARIANTS[
                    (BOARD_VARIANTS.indexOf(props.variant) + 1) %
                      BOARD_VARIANTS.length
                  ]
                )}
                onClick={() => step(1)}
              >
                <CaretRightIcon />
              </Button>
            </HeaderActionGroup>
          </ViewShell.TopBar>
          <div class="relative min-h-0 flex-1 overflow-hidden border-t border-edge-muted">
            <Dynamic
              component={VARIANT_VIEWS[props.variant]}
              {...variantProps}
            />
          </div>
        </ViewShell.Main>
      </ViewShell.Root>
      <BoardModal
        item={openItem()}
        onClose={closeModal}
        onCloseAutoFocus={(event) => {
          if (!opener?.isConnected) return;
          event.preventDefault();
          opener.focus({ preventScroll: true });
        }}
        onDismiss={(key) => {
          const item = scene.item(key);
          if (item) variantProps.onDismiss(key, item.lastActivityAt);
        }}
        onOpenInSplit={(key, newSplit) => {
          closeModal();
          board.openInSplit(key, { newSplit });
        }}
      />
    </>
  );
}
