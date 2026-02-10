import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import XIcon from '@icon/regular/x.svg?component-solid';
import PreviewIcon from '@macro-icons/wide/preview.svg';
import NoiseIcon from '@macro-icons/wide/noise.svg';
import SignalIcon from '@macro-icons/wide/signal.svg';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { useSettingsState } from '@core/constant/SettingsState';
import { TOKENS } from '@core/hotkey/tokens';
import {
  For,
  Show,
  onCleanup,
  createSignal,
  onMount,
  createEffect,
  type Component,
} from 'solid-js';
import {
  ANIMATED_ICONS,
  ENTITY_TYPE_FILTER_CONFIGS,
  type FilterID,
  getEntityTypeFilterIcon,
} from '@app/component/next-soup/filters/filters';
import { ENABLE_ANIMATED_ICONS } from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ValidHotkey } from '@core/hotkey/types';
import { createElementSize } from '@solid-primitives/resize-observer';
import { IS_MAC } from '@core/constant/isMac';
import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';
import { Dynamic } from 'solid-js/web';
import { SortDropdown } from '@app/component/next-soup/soup-view/sort-dropdown';

/**
 * Keyboard shortcuts for entity type filters.
 * This object is the single source of truth for filter shortcuts,
 * used by both the filter buttons and hotkey registrations.
 */
const ENTITY_TYPE_SHORTCUTS: Record<
  (typeof ENTITY_TYPE_FILTER_CONFIGS)[number]['id'],
  ValidHotkey
> = {
  document: 'd',
  task: 't',
  email: 'l',
  people: 'p',
  teams: 'm',
  agent: 'a',
  file: 'f',
};

export const SoupToolbar = () => {
  const { soup } = useSoupView();

  const [scrollContainerRef, setScrollContainerRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  return (
    <>
      <SplitHeaderLeft>
        <div class="relative h-full">
          <ScrollIndicators scrollRef={scrollContainerRef()} />

          <div
            ref={setScrollContainerRef}
            class="flex items-center h-full overflow-x-auto scrollbar-hidden overscroll-none text-xs touch:mobile-width:text-sm"
          >
            <SoupFilters />
            <SearchBar />
          </div>
        </div>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <div class="flex items-center h-full gap-0.5">
          <Tooltip
            tooltip={<LabelAndHotKey label="Clear filters" shortcut="/" />}
          >
            <button
              type="button"
              class="flex items-center gap-1.5 px-2.5 rounded-full text-ink-muted hover:text-accent hover:bg-accent/20 active:bg-accent active:text-panel"
              onClick={soup.filters.clear}
            >
              <XIcon class="size-4.5" />
              <span class="text-xs touch:mobile-width:text-sm leading-none">
                Clear
                <span class="ml-1 font-mono opacity-70">/</span>
              </span>
            </button>
          </Tooltip>
          <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
          <SettingsButton />
        </div>
      </SplitHeaderRight>
    </>
  );
};

const SoupFilters = () => {
  const { soup, setSearchText } = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [sortDropdownOpen, setSortDropdownOpen] = createSignal(false);

  const toggleFilter = (filter: FilterID) => {
    soup.filters.toggle(filter);
  };

  const toggleSignalFilter = () => {
    // If we're going to be removing the signal filter,
    // we should replace it with the explicit-noise filter
    if (soup.filters.isActive('signal')) {
      toggleFilter('explicit-noise');
    } else {
      toggleFilter('signal');
    }

    toggleFilter('not-done');
  };

  const toggleNoiseFilter = () => {
    // If we're going to be removing the noise filter,
    // we should replace it with the explicit-noise filter
    if (soup.filters.isActive('noise')) {
      toggleFilter('explicit-noise');
    } else {
      toggleFilter('noise');
    }

    toggleFilter('not-done');
  };

  const togglePreview = () => {
    const currentPreview = soup.previewEntity();
    if (currentPreview) {
      soup.setPreviewEntity(undefined);
      return;
    }

    const focused = soup.focus.id();

    if (!focused) return;

    soup.setPreviewEntity(focused);
  };

  const hotkeyConfigs: {
    hotkey: ValidHotkey;
    description: string;
    handler: () => void;
  }[] = [
    {
      hotkey: 'i',
      description: 'Toggle Inbox',
      handler: toggleSignalFilter,
    },
    {
      hotkey: 'o',
      description: 'Toggle Other',
      handler: toggleNoiseFilter,
    },
    // Entity type filter hotkeys
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.document,
      description: 'Filter by Docs',
      handler: () => toggleFilter('document'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.task,
      description: 'Filter by Tasks',
      handler: () => toggleFilter('task'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.email,
      description: 'Filter by Mail',
      handler: () => toggleFilter('email'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.people,
      description: 'Filter by People',
      handler: () => toggleFilter('people'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.teams,
      description: 'Filter by Teams',
      handler: () => toggleFilter('teams'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.agent,
      description: 'Filter by Agents',
      handler: () => toggleFilter('agent'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.file,
      description: 'Filter by Files',
      handler: () => toggleFilter('file'),
    },
    {
      hotkey: 'u',
      description: 'Filter by Unread',
      handler: () => toggleFilter('unread'),
    },
    {
      hotkey: 's',
      description: 'Open sort menu',
      handler: () => setSortDropdownOpen((prev) => !prev),
    },
    {
      hotkey: '/',
      description: 'Clear filters',
      handler: () => {
        soup.filters.clear();
        setSearchText('');
      },
    },
    {
      hotkey: 'space',
      description: 'Toggle preview',
      handler: () => {
        togglePreview();
      },
    },
  ];

  const hotkeyDisposers = hotkeyConfigs.map((config) =>
    registerHotkey({
      hotkey: [config.hotkey],
      scopeId: panel.splitHotkeyScope,
      description: config.description,
      keyDownHandler: () => {
        config.handler();
        return true;
      },
    })
  );

  onCleanup(() => {
    hotkeyDisposers.forEach((d) => d.dispose());
  });

  return (
    <>
      {/* Inbox toggle */}
      <FilterButton
        icon={SignalIcon}
        label="Inbox"
        shortcut="i"
        isActive={soup.filters.isActive('signal')}
        onClick={toggleSignalFilter}
      />
      {/* Other toggle */}
      <FilterButton
        icon={NoiseIcon}
        label="Other"
        shortcut="o"
        isActive={soup.filters.isActive('noise')}
        onClick={toggleNoiseFilter}
      />
      <FilterDivider />
      {/* Unread filter */}
      <div class="flex items-center mr-0.5 shrink-0">
        <Tooltip tooltip={<LabelAndHotKey label="Unread Only" shortcut="u" />}>
          <button
            type="button"
            class="flex items-center gap-1 h-[22px] touch:mobile-width:h-9 pr-2.5 pl-1 active:bg-accent active:text-panel rounded-full"
            classList={{
              'bg-accent text-panel': soup.filters.isActive('unread'),
              'text-ink-muted hover:text-accent hover:bg-accent/20':
                !soup.filters.isActive('unread'),
            }}
            onClick={() => soup.filters.toggle('unread')}
          >
            <svg
              class="size-4"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="4" />
            </svg>
            <span class="leading-none">
              <ShortcutLabel label="Unread" shortcut="u" />
            </span>
          </button>
        </Tooltip>
      </div>
      <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
      {/* Entity type icons */}
      <div class="flex items-center shrink-0">
        <For each={ENTITY_TYPE_FILTER_CONFIGS}>
          {(filter) => {
            const iconConfig = () => getEntityTypeFilterIcon(filter.id);
            const shortcut = ENTITY_TYPE_SHORTCUTS[filter.id];
            const animatedIcon = ANIMATED_ICONS[filter.id];

            return (
              <FilterButton
                icon={iconConfig().icon}
                animatedIcon={animatedIcon}
                label={filter.label ?? ''}
                shortcut={shortcut}
                isActive={() => soup.filters.isActive(filter.id)}
                onClick={() => toggleFilter(filter.id)}
                paddingClass="px-2.5"
              />
            );
          }}
        </For>
      </div>
      <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
      {/* Preview toggle */}
      <Tooltip
        tooltip={<LabelAndHotKey label="Toggle Preview" shortcut="space" />}
      >
        <button
          type="button"
          class="flex items-center gap-1.5 h-[22px] touch:mobile-width:h-9 px-2.5 active:bg-accent active:text-panel rounded-full"
          classList={{
            'bg-accent text-panel': !!soup.previewEntity(),
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !soup.previewEntity(),
          }}
          disabled={!soup.focus.id()}
          onClick={togglePreview}
        >
          <PreviewIcon class="size-4.5" />
          <span class="leading-none">
            <ShortcutLabel label="Preview" shortcut="space" />
          </span>
        </button>
      </Tooltip>
      <FilterDivider />
      {/* Sort dropdown */}
      <SortDropdown
        open={sortDropdownOpen}
        onOpenChange={setSortDropdownOpen}
        value={() => soup.sort.active()[0].id as SystemSortOption}
        onChange={(value) => {
          soup.sort.setAll([value]);
        }}
      />
      <div class="touch:mobile-width:-order-1">
        <FilterDivider />
      </div>
      {/* Filter search bar */}
    </>
  );
};

function SettingsButton() {
  const { settingsOpen, toggleSettings } = useSettingsState();
  const { getSplitCount } = useSplitLayout();

  // Hide settings button when there are multiple splits
  const isSingleSplit = () => getSplitCount() <= 1;

  return (
    <Show when={isSingleSplit()}>
      <Tooltip
        tooltip={
          <LabelAndHotKey
            label={settingsOpen() ? 'Close Settings' : 'Open Settings'}
            hotkeyToken={TOKENS.global.toggleSettings}
          />
        }
      >
        <button
          type="button"
          class="relative flex items-center justify-center size-[22px] rounded-full active:bg-accent active:text-panel"
          classList={{
            'bg-hover text-ink': settingsOpen(),
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !settingsOpen(),
          }}
          onClick={() => toggleSettings()}
        >
          <IconGear class="size-4.5" />
        </button>
      </Tooltip>
    </Show>
  );
}

const ScrollIndicators = (props: { scrollRef: HTMLElement | undefined }) => {
  const [leftOpacity, setLeftOpacity] = createSignal(0);
  const [rightOpacity, setRightOpacity] = createSignal(0);
  const SCROLL_THRESHOLD = 10;

  // Track size changes to update indicators
  const size = createElementSize(() => props.scrollRef);
  const containerWidth = () => size.width ?? 0;

  const updateClipIndicators = () => {
    const ref = props.scrollRef;
    if (!ref) return;
    const { scrollLeft, scrollWidth, clientWidth } = ref;

    const leftAmount = Math.min(scrollLeft, SCROLL_THRESHOLD);
    setLeftOpacity(leftAmount / SCROLL_THRESHOLD);

    const maxScroll = scrollWidth - clientWidth;
    const remainingScroll = maxScroll - scrollLeft;
    const rightAmount = Math.min(remainingScroll, SCROLL_THRESHOLD);
    setRightOpacity(rightAmount / SCROLL_THRESHOLD);
  };

  // Update indicators when size changes
  createEffect(() => {
    containerWidth(); // Track size changes
    updateClipIndicators();
  });

  onMount(() => {
    const ref = props.scrollRef;
    if (!ref) return;
    ref.addEventListener('scroll', updateClipIndicators);
    onCleanup(() => ref?.removeEventListener('scroll', updateClipIndicators));
  });
  return (
    <>
      {/* Left clip boundary indicator */}
      <div
        class="absolute pointer-events-none left-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-r-from-0% border-l border-edge-muted"
        style={{ opacity: leftOpacity() }}
      />
      {/* Right clip boundary indicator */}
      <div
        class="absolute pointer-events-none right-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-l-from-0% border-r border-edge-muted"
        style={{ opacity: rightOpacity() }}
      />
    </>
  );
};

const SearchBar = () => {
  const { searchText, setSearchText } = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [ref, setRef] = createSignal<HTMLInputElement | undefined>();

  const [searchFocused, setSearchFocused] = createSignal(false);

  const searchHotkey = registerHotkey({
    hotkey: ['cmd+f'],
    scopeId: panel.splitHotkeyScope,
    description: 'Search',
    keyDownHandler: () => {
      ref()?.focus();
      if (ref()?.value) ref()?.select();
      return true;
    },
  });

  onCleanup(searchHotkey.dispose);

  return (
    <div class="flex items-center shrink-0 touch:mobile-width:-order-2">
      <Tooltip tooltip={<LabelAndHotKey label="Filter" shortcut="⌘F" />}>
        <div
          class="relative flex items-center gap-1.5 h-[22px] touch:mobile-width:h-9 px-2.5 rounded-full touch:mobile-width:min-w-35"
          classList={{
            'bg-accent text-panel': !!searchText() && !searchFocused(),
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !searchText() || searchFocused(),
          }}
          onClick={() => ref()?.focus()}
        >
          <SearchIcon class="size-4.5 shrink-0" />
          <Show when={!searchText() && !searchFocused()}>
            <span class="leading-none pointer-events-none">
              <span class="underline underline-offset-2 decoration-current/60">
                {IS_MAC ? '⌘' : '^'}F
              </span>
              <span>ilter</span>
            </span>
          </Show>
          <input
            ref={setRef}
            type="text"
            value={searchText()}
            onInput={(e) => setSearchText(e.currentTarget.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (
                e.key === 'Escape' ||
                e.key === 'Enter' ||
                e.key === 'ArrowDown'
              ) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            class="p-0 bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 cursor-default"
            style={{
              width:
                !searchText() && !searchFocused()
                  ? '0'
                  : `${Math.max(5, searchText().length + 1)}ch`,
            }}
          />
        </div>
      </Tooltip>
    </div>
  );
};

const SHORTCUT_SUFFIXES: Record<string, string> = { space: '␣', '/': '/' };

export const ShortcutLabel: Component<{ label: string; shortcut: string }> = (
  props
) => {
  const s = props.shortcut.trim();
  if (!s) return <>{props.label}</>;

  const suffix = SHORTCUT_SUFFIXES[s.toLowerCase()] ?? SHORTCUT_SUFFIXES[s];
  if (suffix) {
    return (
      <>
        {props.label}
        <span class="ml-1 font-mono opacity-70">{suffix}</span>
      </>
    );
  }

  const idx = props.label.toLowerCase().indexOf(s.toLowerCase());
  if (idx === -1) return <>{props.label}</>;

  return (
    <>
      {props.label.slice(0, idx)}
      <span class="underline underline-offset-2 decoration-current/60">
        {props.label.slice(idx, idx + s.length)}
      </span>
      {props.label.slice(idx + s.length)}
    </>
  );
};

export interface FilterButtonProps {
  icon: Component<{ class?: string }>;
  animatedIcon?: Component<{ triggerAnimation?: boolean }>;
  label: string;
  shortcut: string;
  isActive: (() => boolean) | boolean;
  onClick: () => void;
  paddingClass?: string;
}

export const FilterButton: Component<FilterButtonProps> = (props) => {
  const [isHovered, setIsHovered] = createSignal(false);

  const isActive = () =>
    typeof props.isActive === 'function' ? props.isActive() : props.isActive;

  return (
    <div class="flex items-center mr-0.5 shrink-0">
      <Tooltip
        tooltip={
          <LabelAndHotKey label={props.label} shortcut={props.shortcut} />
        }
      >
        <button
          type="button"
          class={`flex items-center gap-1 h-[22px] touch:mobile-width:h-9 ${props.paddingClass ?? 'pl-2 pr-2.5'} active:bg-accent active:text-panel rounded-full`}
          classList={{
            'bg-accent text-panel': isActive(),
            'text-ink-muted hover:text-accent hover:bg-accent/20': !isActive(),
          }}
          onClick={props.onClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <Show
            when={ENABLE_ANIMATED_ICONS && props.animatedIcon}
            fallback={<Dynamic component={props.icon} class="size-3.5" />}
          >
            {(Icon) => (
              <div class="size-3.5 overflow-visible">
                <Dynamic
                  component={Icon()}
                  triggerAnimation={isHovered() || isActive()}
                />
              </div>
            )}
          </Show>
          <span class="leading-none">
            <ShortcutLabel label={props.label} shortcut={props.shortcut} />
          </span>
        </button>
      </Tooltip>
    </div>
  );
};

export const FilterDivider: Component = () => (
  <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
);
