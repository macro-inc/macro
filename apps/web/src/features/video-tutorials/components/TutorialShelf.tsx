import { t } from '@app/lib/i18n';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import CalendarCheckIcon from '@icon/system/regular/calendar-check.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import FolderSimpleIcon from '@icon/system/regular/folder-simple.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import HouseIcon from '@icon/system/regular/house.svg';
import LaptopIcon from '@icon/system/regular/laptop.svg';
import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import ShapesIcon from '@icon/system/regular/shapes.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import TableIcon from '@icon/system/regular/table.svg';
import WhatsappIcon from '@phosphor/whatsapp-logo.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { TutorialId } from '../core/tutorial-id';

export type ShelfTutorial = {
  id: TutorialId;
  title: string;
  /** "Macro Mail" */
  block: string;
  length: string;
};

type Tile = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  /** Two of the theme's hue tokens, washed toward white into a pastel. */
  from: string;
  to: string;
};

/** Each block's tile: the icon the app's navigation shows for it, on its own wash. */
const TILES: Record<TutorialId, Tile> = {
  mail: { icon: EnvelopeIcon, from: '--color-blue', to: '--color-cyan' },
  home: { icon: HouseIcon, from: '--color-amber', to: '--color-orange' },
  chat: { icon: ChatsCircleIcon, from: '--color-violet', to: '--color-blue' },
  tasks: { icon: ListChecksIcon, from: '--color-green', to: '--color-teal' },
  docs: { icon: FileTextIcon, from: '--color-blue', to: '--color-violet' },
  spreadsheets: { icon: TableIcon, from: '--color-lime', to: '--color-teal' },
  databases: { icon: DatabaseIcon, from: '--color-cyan', to: '--color-blue' },
  canvas: { icon: ShapesIcon, from: '--color-red', to: '--color-orange' },
  drive: {
    icon: FolderSimpleIcon,
    from: '--color-yellow',
    to: '--color-amber',
  },
  crm: { icon: BuildingsIcon, from: '--color-teal', to: '--color-blue' },
  calendar: {
    icon: CalendarBlankIcon,
    from: '--color-red',
    to: '--color-pink',
  },
  calls: { icon: PhoneCallIcon, from: '--color-lime', to: '--color-green' },
  agents: { icon: AgentIcon, from: '--color-purple', to: '--color-pink' },
  macrod: { icon: LaptopIcon, from: '--color-cyan', to: '--color-violet' },
  github: {
    icon: GitPullRequestIcon,
    from: '--color-purple',
    to: '--color-violet',
  },
  scheduling: {
    icon: CalendarCheckIcon,
    from: '--color-orange',
    to: '--color-pink',
  },
  whatsapp: { icon: WhatsappIcon, from: '--color-green', to: '--color-lime' },
};

function TileArt(props: { tutorial: ShelfTutorial }) {
  const tile = () => TILES[props.tutorial.id];
  return (
    <span
      class="relative flex aspect-video w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl text-[black]/80 mobile:gap-1 mobile:rounded-lg"
      style={{
        'background-image': `linear-gradient(135deg, color-mix(in oklch, var(${tile().from}) 38%, white), color-mix(in oklch, var(${tile().to}) 30%, white))`,
      }}
    >
      <Dynamic
        component={tile().icon}
        class="size-7 shrink-0 mobile:size-5"
        aria-hidden="true"
      />
      <span class="truncate px-2 text-sm font-semibold mobile:text-xs">
        {props.tutorial.block}
      </span>
      <span class="absolute right-1.5 bottom-1.5 rounded-md bg-[black]/75 px-1.5 py-0.5 text-[11px] font-medium text-[white] tabular-nums mobile:right-1 mobile:bottom-1 mobile:text-[10px]">
        {props.tutorial.length}
      </span>
    </span>
  );
}

/**
 * Shown over the bottom of the video once it ends: "More videos from Macro",
 * a Replay action, and a row of the other tutorials that scrolls sideways
 * (arrows on desktop when it overflows, a swipe on phones). Arrow keys move
 * between cards.
 */
export function TutorialShelf(props: {
  tutorials: readonly ShelfTutorial[];
  onSelect: (id: TutorialId) => void;
  onReplay: () => void;
  class?: string;
}) {
  const [row, setRow] = createSignal<HTMLDivElement>();
  const rowSize = createElementSize(row);
  const [scroll, setScroll] = createSignal(0);

  // Reads the row's measured width so it updates as the dialog resizes.
  const maxScroll = () => {
    const element = row();
    if (!element || rowSize.width === null) return 0;
    return element.scrollWidth - element.clientWidth;
  };
  const canGoBack = () => scroll() > 1;
  const canGoForward = () => scroll() < maxScroll() - 1;

  const page = (direction: 1 | -1) => {
    const element = row();
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior: 'smooth',
    });
  };

  const moveFocus = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const cards = [
      ...(row()?.querySelectorAll<HTMLButtonElement>('[data-shelf-card]') ??
        []),
    ];
    const index = cards.findIndex((card) => card === document.activeElement);
    if (index < 0) return;
    const next = cards[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div class={props.class}>
      <div class="flex items-center gap-2 px-5 pb-2 mobile:px-3 mobile:pb-1.5">
        <h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-[white] mobile:text-xs">
          {t('tutorials.moreVideos')}
        </h3>
        <Show when={canGoBack() || canGoForward()}>
          <Button
            variant="secondary"
            size="icon-sm"
            class="mobile:hidden"
            aria-label={t('tutorials.previousVideos')}
            disabled={!canGoBack()}
            onClick={() => page(-1)}
          >
            <CaretLeftIcon class="size-4 shrink-0" />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            class="mobile:hidden"
            aria-label={t('tutorials.nextVideos')}
            disabled={!canGoForward()}
            onClick={() => page(1)}
          >
            <CaretRightIcon class="size-4 shrink-0" />
          </Button>
        </Show>
        <Button variant="secondary" size="sm" onClick={props.onReplay}>
          <ArrowCounterClockwiseIcon class="size-4 shrink-0" />
          {t('tutorials.replay')}
        </Button>
      </div>
      <div
        ref={setRow}
        onScroll={(event) => setScroll(event.currentTarget.scrollLeft)}
        onKeyDown={moveFocus}
        class="scrollbar-hidden flex snap-x gap-3 overflow-x-auto scroll-px-5 px-5 pb-4 mobile:gap-2 mobile:scroll-px-3 mobile:px-3 mobile:pb-3"
      >
        <For each={props.tutorials}>
          {(tutorial) => (
            <button
              type="button"
              data-shelf-card
              aria-label={`${tutorial.title}, ${tutorial.length}`}
              onClick={() => props.onSelect(tutorial.id)}
              class="group/card flex w-44 shrink-0 snap-start flex-col gap-1.5 rounded-xl text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[white] mobile:w-32"
            >
              <span class="block w-full transition-transform not-touch:group-hover/card:-translate-y-0.5">
                <TileArt tutorial={tutorial} />
              </span>
              <span class="line-clamp-2 text-xs font-medium text-[white]/85 mobile:line-clamp-1 mobile:text-[11px]">
                {tutorial.title}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
