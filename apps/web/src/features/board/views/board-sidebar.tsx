import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { IS_MAC } from '@core/constant/isMac';
import ChartGanttIcon from '@icon/system/regular/chart-gantt.svg';
import ChatCircleDotsIcon from '@icon/system/regular/chat-circle-dots.svg';
import CrosshairIcon from '@icon/system/regular/crosshair.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import MagicWandIcon from '@icon/system/regular/magic-wand.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  BOARD_VARIANTS,
  type BoardVariant,
  variantCode,
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
    .exhaustive();
}

export function variantName(variant: BoardVariant): string {
  return match(variant)
    .with('v1a', () => t('board.v1aName'))
    .with('v1b', () => t('board.v1bName'))
    .with('v1c', () => t('board.v1cName'))
    .with('v1d', () => t('board.v1dName'))
    .with('v1e', () => t('board.v1eName'))
    .exhaustive();
}

export function variantDescription(variant: BoardVariant): string {
  return match(variant)
    .with('v1a', () => t('board.v1aDescription'))
    .with('v1b', () => t('board.v1bDescription'))
    .with('v1c', () => t('board.v1cDescription'))
    .with('v1d', () => t('board.v1dDescription'))
    .with('v1e', () => t('board.v1eDescription'))
    .exhaustive();
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
  const [variantsOpen, setVariantsOpen] = createSignal(true);
  const [boardOpen, setBoardOpen] = createSignal(true);

  return (
    <ViewSidebar.Root aria-label={t('board.title')}>
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>{t('board.title')}</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Content>
        <CollapsibleSection.Root
          open={variantsOpen()}
          onOpenChange={setVariantsOpen}
        >
          <CollapsibleSection.Trigger>
            <span class="min-w-0 truncate">{t('board.variants')}</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label={t('board.variantsNav')}>
              <For each={BOARD_VARIANTS}>
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

        <CollapsibleSection.Root open={boardOpen()} onOpenChange={setBoardOpen}>
          <CollapsibleSection.Trigger>
            <span class="min-w-0 truncate">{t('board.thisBoard')}</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <div class="flex flex-col gap-(--sidebar-row-gap)">
              <p class="px-(--sidebar-item-inset) pb-1 text-xs text-ink-muted">
                {t('board.itemsOnBoard', { count: props.scene.items().length })}
                <Show when={props.scene.unreadCount() > 0}>
                  {' · '}
                  <span class="text-accent">
                    {t('board.unreadOnBoard', {
                      count: props.scene.unreadCount(),
                    })}
                  </span>
                </Show>
              </p>
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
                <span class="min-w-0 flex-1 truncate">{t('board.tidyUp')}</span>
              </ViewSidebar.Item>
              <p class="px-(--sidebar-item-inset) pt-2 text-xs leading-4 text-ink-extra-muted">
                {t('board.boardHelp', { modifier: IS_MAC ? '⌘' : 'Ctrl' })}
              </p>
            </div>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
