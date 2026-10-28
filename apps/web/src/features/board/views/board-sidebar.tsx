import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { IS_MAC } from '@core/constant/isMac';
import ArticleIcon from '@icon/system/regular/article.svg';
import ChartGanttIcon from '@icon/system/regular/chart-gantt.svg';
import ChatCircleDotsIcon from '@icon/system/regular/chat-circle-dots.svg';
import ChatsIcon from '@icon/system/regular/chats.svg';
import CrosshairIcon from '@icon/system/regular/crosshair.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import ListIcon from '@icon/system/regular/list.svg';
import MagicWandIcon from '@icon/system/regular/magic-wand.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  BOARD_VARIANTS,
  type BoardVariant,
  type VariantFamily,
  variantCode,
  variantFamily,
} from '../core/variants';
import type { BoardMemory } from '../primitives/board-memory';
import type { BoardScene } from '../primitives/board-scene';

type Glyph = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

export function variantGlyph(variant: BoardVariant): Glyph {
  return match(variant)
    .returnType<Glyph>()
    .with('v1a', () => SquaresFourIcon)
    .with('v1b', () => ChatCircleDotsIcon)
    .with('v1c', () => ChartGanttIcon)
    .with('v1d', () => CrosshairIcon)
    .with('v1e', () => UsersThreeIcon)
    .with('v2a', () => ListIcon)
    .with('v2b', () => ArticleIcon)
    .with('v2c', () => ChatsIcon)
    .exhaustive();
}

export function variantName(variant: BoardVariant): string {
  return match(variant)
    .with('v1a', () => t('board.v1aName'))
    .with('v1b', () => t('board.v1bName'))
    .with('v1c', () => t('board.v1cName'))
    .with('v1d', () => t('board.v1dName'))
    .with('v1e', () => t('board.v1eName'))
    .with('v2a', () => t('board.v2aName'))
    .with('v2b', () => t('board.v2bName'))
    .with('v2c', () => t('board.v2cName'))
    .exhaustive();
}

export function variantDescription(variant: BoardVariant): string {
  return match(variant)
    .with('v1a', () => t('board.v1aDescription'))
    .with('v1b', () => t('board.v1bDescription'))
    .with('v1c', () => t('board.v1cDescription'))
    .with('v1d', () => t('board.v1dDescription'))
    .with('v1e', () => t('board.v1eDescription'))
    .with('v2a', () => t('board.v2aDescription'))
    .with('v2b', () => t('board.v2bDescription'))
    .with('v2c', () => t('board.v2cDescription'))
    .exhaustive();
}

/** The variants one sidebar section lists. */
function VariantNav(props: {
  family: VariantFamily;
  title: string;
  label: string;
  variant: BoardVariant;
  onVariantChange: (variant: BoardVariant) => void;
}) {
  const [open, setOpen] = createSignal(true);
  return (
    <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
      <CollapsibleSection.Trigger>
        <span class="min-w-0 truncate">{props.title}</span>
        <CollapsibleSection.Indicator />
      </CollapsibleSection.Trigger>
      <CollapsibleSection.Content>
        <ViewSidebar.Nav aria-label={props.label}>
          <For
            each={BOARD_VARIANTS.filter(
              (variant) => variantFamily(variant) === props.family
            )}
          >
            {(variant) => (
              <ViewSidebar.Item
                active={props.variant === variant}
                title={variantDescription(variant)}
                onClick={() => props.onVariantChange(variant)}
              >
                <ViewSidebar.Icon>
                  <Dynamic component={variantGlyph(variant)} />
                </ViewSidebar.Icon>
                <span class="min-w-0 flex-1 truncate">
                  {variantName(variant)}
                </span>
                <span class="shrink-0 font-mono text-[11px] tracking-tight text-ink-extra-muted">
                  {variantCode(variant)}
                </span>
              </ViewSidebar.Item>
            )}
          </For>
        </ViewSidebar.Nav>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

/**
 * The board's navigation: the variants to cycle through, then what is on
 * this board and its settings.
 */
export function BoardSidebar(props: {
  variant: BoardVariant;
  onVariantChange: (variant: BoardVariant) => void;
  scene: BoardScene;
  memory: BoardMemory;
}) {
  const [boardOpen, setBoardOpen] = createSignal(true);
  const isList = () => variantFamily(props.variant) === 'list';
  // Lists show everything; boards show what has not gone quiet.
  const shown = () =>
    isList() ? props.scene.all().length : props.scene.items().length;
  const unread = () =>
    isList()
      ? props.scene.all().reduce((total, item) => total + item.unreadCount, 0)
      : props.scene.unreadCount();

  return (
    <ViewSidebar.Root aria-label={t('board.title')}>
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>{t('board.title')}</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Content>
        <VariantNav
          family="board"
          title={t('board.groupBoards')}
          label={t('board.variantsNav')}
          variant={props.variant}
          onVariantChange={props.onVariantChange}
        />
        <VariantNav
          family="list"
          title={t('board.groupLists')}
          label={t('board.listVariantsNav')}
          variant={props.variant}
          onVariantChange={props.onVariantChange}
        />

        <CollapsibleSection.Root open={boardOpen()} onOpenChange={setBoardOpen}>
          <CollapsibleSection.Trigger>
            <span class="min-w-0 truncate">
              {isList() ? t('board.thisList') : t('board.thisBoard')}
            </span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <div class="flex flex-col gap-(--sidebar-row-gap)">
              <p class="px-(--sidebar-item-inset) pb-1 text-xs text-ink-muted">
                {t('board.itemsOnBoard', { count: shown() })}
                <Show when={unread() > 0}>
                  {' · '}
                  <span class="text-accent">
                    {t('board.unreadOnBoard', { count: unread() })}
                  </span>
                </Show>
              </p>
              <Show when={!isList()}>
                <ViewSidebar.Item
                  aria-pressed={props.memory.showSettled()}
                  onClick={() =>
                    props.memory.setShowSettled(!props.memory.showSettled())
                  }
                >
                  <ViewSidebar.Icon>
                    <Show
                      when={props.memory.showSettled()}
                      fallback={<EyeSlashIcon />}
                    >
                      <EyeIcon />
                    </Show>
                  </ViewSidebar.Icon>
                  <span class="min-w-0 flex-1 truncate">
                    {t('board.showSettled')}
                  </span>
                  <Show when={props.scene.hiddenCount() > 0}>
                    <span class="shrink-0 text-xs tabular-nums text-ink-extra-muted">
                      {props.scene.hiddenCount()}
                    </span>
                  </Show>
                </ViewSidebar.Item>
                <ViewSidebar.Item
                  disabled={!props.memory.hasMoved(props.variant)}
                  title={t('board.tidyUpDescription')}
                  onClick={() => props.memory.tidy(props.variant)}
                >
                  <ViewSidebar.Icon>
                    <MagicWandIcon />
                  </ViewSidebar.Icon>
                  <span class="min-w-0 flex-1 truncate">
                    {t('board.tidyUp')}
                  </span>
                </ViewSidebar.Item>
              </Show>
              <p class="px-(--sidebar-item-inset) pt-2 text-xs leading-4 text-ink-extra-muted">
                {isList()
                  ? t('board.listHelp')
                  : t('board.boardHelp', { modifier: IS_MAC ? '⌘' : 'Ctrl' })}
              </p>
            </div>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
