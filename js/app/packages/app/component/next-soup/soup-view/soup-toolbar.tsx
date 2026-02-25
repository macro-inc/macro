import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import BackspaceIcon from '@icon/regular/backspace.svg?component-solid';
import XIcon from '@icon/regular/x.svg?component-solid';
import PreviewIcon from '@macro-icons/wide/preview.svg';
import NoiseIcon from '@macro-icons/wide/noise.svg';
import SignalIcon from '@macro-icons/wide/signal.svg';
import { AnimatedNoiseIcon } from '@macro-icons/wide/animating/noise';
import { AnimatedSignalIcon } from '@macro-icons/wide/animating/signal';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';

import {
  For,
  Show,
  onCleanup,
  createSignal,
  onMount,
  createEffect,
  batch,
  type Component,
} from 'solid-js';
import {
  ANIMATED_ICONS,
  ENTITY_TYPE_FILTER_CONFIGS,
  EXCLUDE,
  getEntityTypeFilterIcon,
  QUERY_FILTERS,
} from '@app/component/next-soup/filters/filters';
import {
  applyInboxQueryFilters,
  applyOtherQueryFilters,
  removeInboxQueryFilters,
  removeOtherQueryFilters,
} from '@app/component/next-soup/filters/inbox-query-filters';
import { ENABLE_ANIMATED_ICONS } from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useEmailLinksStatus } from '@core/email-link';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ValidHotkey } from '@core/hotkey/types';
import { createElementSize } from '@solid-primitives/resize-observer';
import { IS_MAC } from '@core/constant/isMac';
import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';
import { Dynamic } from 'solid-js/web';
import { SortDropdown } from '@app/component/next-soup/soup-view/sort-dropdown';
import { SettingsButton } from '@app/component/settings/SettingsButton';
import {
  TaskStatusDropdown,
  TaskAssigneeDropdown,
} from '@app/component/next-soup/soup-view/task-sub-filters';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { match } from 'ts-pattern';

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
  const { soup, setSearchText, setQueryFilters } = useSoupView();

  const [scrollContainerRef, setScrollContainerRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  const handleClear = () => {
    batch(() => {
      soup.filters.clear();
      setSearchText('');
      setQueryFilters(QUERY_FILTERS.default);
    });
  };

  return (
    <>
      <SplitHeaderLeft>
        <div class="relative h-full w-full">
          <ScrollIndicators scrollRef={scrollContainerRef()} />

          <div
            ref={setScrollContainerRef}
            class="flex items-center h-full w-full overflow-x-auto scrollbar-hidden overscroll-none text-xs mobile:text-sm"
          >
            <SoupFilters />
            <SearchBar />
          </div>
        </div>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <Tooltip
          tooltip={<LabelAndHotKey label="Clear filters" shortcut="/" />}
        >
          <button
            type="button"
            class="flex items-center justify-center size-[22px] rounded-full text-ink-muted hover:text-accent hover:bg-accent/20 active:bg-accent active:text-panel"
            onClick={handleClear}
          >
            <BackspaceIcon class="size-4.5" />
          </button>
        </Tooltip>
        <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
        <SettingsButton />
      </SplitHeaderRight>
    </>
  );
};

type EntityTypeFilterId =
  | 'document'
  | 'task'
  | 'people'
  | 'teams'
  | 'agent'
  | 'file';

const SoupFilters = () => {
  const { soup, setSearchText, setQueryFilters } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const emailActive = useEmailLinksStatus();

  const [sortDropdownOpen, setSortDropdownOpen] = createSignal(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = createSignal(false);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = createSignal(false);

  const setQueryFiltersInboxAware = (filters: SoupItemsQueryFilters) => {
    if (soup.filters.isActive('signal')) {
      setQueryFilters(applyInboxQueryFilters(filters));
      return;
    }
    if (soup.filters.isActive('noise')) {
      setQueryFilters(applyOtherQueryFilters(removeInboxQueryFilters(filters)));
      return;
    }
    setQueryFilters(removeInboxQueryFilters(filters));
  };

  // Batch filter + query updates so the prefetch effect in soup-view-context
  // sees the final query filters and active filter state in a single tick,
  // avoiding intermediate re-renders with mismatched query keys.
  const toggleFocus = (id: 'signal' | 'noise') => {
    const comb = { id, isActive: soup.filters.isActive(id) };

    const activateFocus = () => {
      soup.filters.toggle(id);
      soup.filters.activate('not-done');
    };

    const deactivateFocus = () => {
      soup.filters.toggle('explicit-noise');
      soup.filters.deactivate('not-done');
    };

    batch(() => {
      match(comb)
        .with({ id: 'signal', isActive: false }, () => {
          setQueryFilters((prev) =>
            applyInboxQueryFilters(removeOtherQueryFilters(prev))
          );
          activateFocus();
        })
        .with({ id: 'noise', isActive: false }, () => {
          setQueryFilters((prev) =>
            applyOtherQueryFilters(removeInboxQueryFilters(prev))
          );
          activateFocus();
        })
        .with({ id: 'signal', isActive: true }, () => {
          setQueryFilters(removeInboxQueryFilters);
          deactivateFocus();
        })
        .with({ id: 'noise', isActive: true }, () => {
          setQueryFilters(removeOtherQueryFilters);
          deactivateFocus();
        })
        .exhaustive();
    });
  };

  const toggleUnread = () => {
    soup.filters.toggle('unread');
  };

  const toggleEntityType = (id: EntityTypeFilterId) => {
    const willBeActive = !soup.filters.isActive(id);
    batch(() => {
      soup.filters.toggle(id);
      setQueryFiltersInboxAware(
        willBeActive ? QUERY_FILTERS[id] : QUERY_FILTERS.default
      );
    });
  };

  // Email has special handling for email integration status
  const toggleEmail = () => {
    const willBeActive = !soup.filters.isActive('email');
    batch(() => {
      soup.filters.toggle('email');
      if (willBeActive) {
        const shouldIncludeEmails = emailActive();
        setQueryFiltersInboxAware({
          ...QUERY_FILTERS.email,
          email_filters: {
            recipients: shouldIncludeEmails ? [] : EXCLUDE,
          },
        });
      } else {
        setQueryFiltersInboxAware(QUERY_FILTERS.default);
      }
    });
  };

  const entityTypeToggleHandlers: Record<
    (typeof ENTITY_TYPE_FILTER_CONFIGS)[number]['id'],
    () => void
  > = {
    document: () => toggleEntityType('document'),
    task: () => toggleEntityType('task'),
    email: toggleEmail,
    people: () => toggleEntityType('people'),
    teams: () => toggleEntityType('teams'),
    agent: () => toggleEntityType('agent'),
    file: () => toggleEntityType('file'),
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
      handler: () => toggleFocus('signal'),
    },
    {
      hotkey: 'o',
      description: 'Toggle Other',
      handler: () => toggleFocus('noise'),
    },
    // Entity type filter hotkeys
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.document,
      description: 'Filter by Docs',
      handler: () => toggleEntityType('document'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.task,
      description: 'Filter by Tasks',
      handler: () => toggleEntityType('task'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.email,
      description: 'Filter by Mail',
      handler: toggleEmail,
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.people,
      description: 'Filter by People',
      handler: () => toggleEntityType('people'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.teams,
      description: 'Filter by Teams',
      handler: () => toggleEntityType('teams'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.agent,
      description: 'Filter by Agents',
      handler: () => toggleEntityType('agent'),
    },
    {
      hotkey: ENTITY_TYPE_SHORTCUTS.file,
      description: 'Filter by Files',
      handler: () => toggleEntityType('file'),
    },
    {
      hotkey: 'u',
      description: 'Filter by Unread',
      handler: toggleUnread,
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
        batch(() => {
          soup.filters.clear();
          setQueryFilters(QUERY_FILTERS.default);
          setSearchText('');
        });
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

  const taskSubFilterHotkeyDisposers = [
    registerHotkey({
      hotkey: ['shift+s'],
      scopeId: panel.splitHotkeyScope,
      condition: () => soup.filters.isActive('task'),
      description: 'Open status filter',
      keyDownHandler: () => {
        setStatusDropdownOpen((prev) => !prev);
        return true;
      },
    }),
    registerHotkey({
      hotkey: ['shift+a'],
      scopeId: panel.splitHotkeyScope,
      condition: () => soup.filters.isActive('task'),
      description: 'Open assignee filter',
      keyDownHandler: () => {
        setAssigneeDropdownOpen((prev) => !prev);
        return true;
      },
    }),
  ];

  onCleanup(() => taskSubFilterHotkeyDisposers.forEach((d) => d.dispose()));

  return (
    <>
      {/* Inbox toggle */}
      <FilterButton
        icon={SignalIcon}
        animatedIcon={AnimatedSignalIcon}
        label="Inbox"
        shortcut="i"
        isActive={soup.filters.isActive('signal')}
        onClick={() => toggleFocus('signal')}
      />
      {/* Other toggle */}
      <FilterButton
        icon={NoiseIcon}
        animatedIcon={AnimatedNoiseIcon}
        label="Other"
        shortcut="o"
        isActive={soup.filters.isActive('noise')}
        onClick={() => toggleFocus('noise')}
      />
      <FilterDivider />
      {/* Unread filter */}
      <div class="flex items-center mr-0.5 shrink-0">
        <Tooltip tooltip={<LabelAndHotKey label="Unread Only" shortcut="u" />}>
          <button
            type="button"
            class="flex items-center gap-1 h-[22px] mobile:h-9 pr-2.5 pl-1 active:bg-accent active:text-panel rounded-full"
            classList={{
              'bg-accent text-panel': soup.filters.isActive('unread'),
              'text-ink-muted hover:text-accent hover:bg-accent/20':
                !soup.filters.isActive('unread'),
            }}
            onClick={toggleUnread}
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
                onClick={entityTypeToggleHandlers[filter.id]}
                paddingClass="px-2.5"
              />
            );
          }}
        </For>
      </div>
      <Show when={soup.filters.isActive('task')}>
        <FilterDivider />
        <div class="flex items-center gap-1 shrink-0">
          <TaskStatusDropdown
            open={statusDropdownOpen}
            onOpenChange={setStatusDropdownOpen}
          />
          <TaskAssigneeDropdown
            open={assigneeDropdownOpen}
            onOpenChange={setAssigneeDropdownOpen}
          />
        </div>
      </Show>
      <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
      {/* Preview toggle */}
      <Tooltip
        tooltip={<LabelAndHotKey label="Toggle Preview" shortcut="space" />}
      >
        <button
          type="button"
          class="flex items-center gap-1.5 h-[22px] mobile:h-9 px-2.5 active:bg-accent active:text-panel rounded-full"
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
      <div class="mobile:-order-1">
        <FilterDivider />
      </div>
      {/* Filter search bar */}
    </>
  );
};

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
  let measureSpan: HTMLSpanElement | undefined;

  const [searchFocused, setSearchFocused] = createSignal(false);
  const [measuredWidth, setMeasuredWidth] = createSignal(0);

  createEffect(() => {
    if (measureSpan) {
      measureSpan.textContent = searchText() || '';
      setMeasuredWidth(measureSpan.scrollWidth);
    }
  });

  const searchHotkey = registerHotkey({
    hotkey: ['cmd+f'],
    scopeId: panel.splitHotkeyScope,
    description: 'Search',
    keyDownHandler: () => {
      ref()?.focus();
      return true;
    },
  });

  onCleanup(searchHotkey.dispose);

  const MIN_INPUT_WIDTH = 48;

  const inputWidth = () => {
    if (!searchText() && !searchFocused()) return 0;
    return Math.max(MIN_INPUT_WIDTH, measuredWidth());
  };

  return (
    <div class="flex items-center shrink-0 grow min-w-0 mobile:-order-2">
      <Tooltip
        class="w-fit"
        placement="bottom-start"
        tooltip={<LabelAndHotKey label="Filter" shortcut="⌘F" />}
      >
        <div
          class="relative flex items-center gap-1.5 h-[22px] mobile:h-9 px-2.5 rounded-full mobile:min-w-35"
          classList={{
            'bg-accent text-panel': !!searchText() && !searchFocused(),
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !searchText() && !searchFocused(),
            'bg-accent/15 text-ink': searchFocused(),
          }}
          onMouseDown={(e) => {
            if (e.target !== ref()) {
              e.preventDefault();
              ref()?.focus();
            }
          }}
        >
          <Show
            when={searchText()}
            fallback={<SearchIcon class="size-4.5 shrink-0" />}
          >
            <button
              type="button"
              class="size-4.5 shrink-0 hover:opacity-60"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSearchText('');
              }}
            >
              <XIcon class="size-4.5" />
            </button>
          </Show>
          <span
            ref={(el) => {
              measureSpan = el;
            }}
            class="invisible absolute whitespace-pre"
            aria-hidden="true"
          />
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
            style={{ width: `${inputWidth()}px` }}
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
          class={`flex items-center gap-1 h-[22px] mobile:h-9 ${props.paddingClass ?? 'pl-2 pr-2.5'} active:bg-accent active:text-panel rounded-full`}
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
