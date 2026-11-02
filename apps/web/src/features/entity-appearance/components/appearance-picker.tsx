import { t } from '@app/lib/i18n';
import { type SimpleEmoji, useEmojiData } from '@core/component/Emoji/emojis';
import { recordEmojiUsage } from '@core/component/Emoji/emojiUsage';
import {
  EntityIcon,
  type EntityIconSelector,
  getIconConfig,
} from '@core/component/EntityIcon';
import AcornIcon from '@icon/system/regular/acorn.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import FlagIcon from '@icon/system/regular/flag.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import KnifeIcon from '@icon/system/regular/knife.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PaperclipIcon from '@icon/system/regular/paperclip.svg';
import PuzzleIcon from '@icon/system/regular/puzzle-piece.svg';
import SmileyIcon from '@icon/system/regular/smiley.svg';
import UsersIcon from '@icon/system/regular/users-three.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, InputGroup, Tabs } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  APPEARANCE_COLORS,
  appearanceColor,
  type EntityAppearance,
} from '../core/appearance';
import { ICON_SECTIONS, iconLabel, PICKER_ICON_NAMES } from '../core/catalog';

type AppearanceIcon = NonNullable<EntityAppearance['icon']>;

const EMOJI_CATEGORIES: {
  id:
    | 'recent'
    | 'people'
    | 'nature'
    | 'food'
    | 'activities'
    | 'travel'
    | 'objects'
    | 'symbols'
    | 'flags';
  groups: string[];
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}[] = [
  { id: 'recent', groups: [], icon: ClockIcon },
  {
    id: 'people',
    groups: ['Smileys & Emotion', 'People & Body'],
    icon: SmileyIcon,
  },
  { id: 'nature', groups: ['Animals & Nature'], icon: AcornIcon },
  { id: 'food', groups: ['Food & Drink'], icon: KnifeIcon },
  { id: 'activities', groups: ['Activities'], icon: PuzzleIcon },
  { id: 'travel', groups: ['Travel & Places'], icon: BuildingsIcon },
  { id: 'objects', groups: ['Objects'], icon: PaperclipIcon },
  { id: 'symbols', groups: ['Symbols'], icon: HashIcon },
  { id: 'flags', groups: ['Flags'], icon: FlagIcon },
];

export function AppearancePicker(props: {
  appearance: EntityAppearance;
  defaultIcon: EntityIconSelector;
  onChange: (appearance: EntityAppearance) => void;
  onClose: () => void;
  recent: readonly AppearanceIcon[];
  onPick: (icon: AppearanceIcon) => void;
  saving: boolean;
  error?: string;
  mobile?: boolean;
}) {
  const [tab, setTab] = createSignal<'icons' | 'emoji'>(
    props.appearance.icon?.kind === 'emoji' ? 'emoji' : 'icons'
  );
  const [search, setSearch] = createSignal('');
  const [category, setCategory] = createSignal('people');
  const emojiData = useEmojiData({ minimumSearchLength: 1 });
  const sectionElements = new Map<string, HTMLElement>();
  let searchElement: HTMLInputElement | undefined;
  let grid: HTMLDivElement | undefined;
  const searching = () => search().trim().length > 0;
  const names = createMemo(() => {
    const words = search()
      .trim()
      .toLowerCase()
      .split(/[\s-]+/);
    return PICKER_ICON_NAMES.filter((name) =>
      words.every((word) => name.includes(word))
    );
  });
  const recentMacros = () =>
    props.recent.filter((icon) => icon.kind === 'macro');
  const recentEmojiEntries = new Map<string, SimpleEmoji>();
  const recentEmojis = () =>
    props.recent.flatMap((icon) => {
      if (icon.kind !== 'emoji') return [];
      let entry = recentEmojiEntries.get(icon.value);
      if (!entry) {
        entry = {
          emoji: icon.value,
          slug: icon.value,
          shortcodes: [],
          terms: [],
        };
        recentEmojiEntries.set(icon.value, entry);
      }
      return [entry];
    });
  const emojiGroups = createMemo(() => {
    const groups = emojiData.groups();
    return EMOJI_CATEGORIES.map((category) => ({
      id: category.id,
      emojis:
        category.id === 'recent'
          ? recentEmojis()
          : groups
              .filter((group) => category.groups.includes(group.name))
              .flatMap((group) => group.emojis),
    })).filter((group) => group.emojis.length > 0);
  });
  const changeSearch = (value: string) => {
    setSearch(value);
    emojiData.filter(value);
    setCategory(emojiGroups()[0]?.id ?? 'people');
    if (grid) grid.scrollTop = 0;
  };
  const updateCategoryFromScroll = () => {
    if (!grid || tab() !== 'emoji' || searching()) return;
    const top = grid.getBoundingClientRect().top;
    let visible = emojiGroups()[0]?.id ?? 'people';
    for (const item of EMOJI_CATEGORIES) {
      const element = sectionElements.get(item.id);
      if (
        element?.isConnected &&
        element.getBoundingClientRect().top <= top + 2
      )
        visible = item.id;
    }
    setCategory(visible);
  };
  const pick = (icon: AppearanceIcon) => {
    props.onChange({ ...props.appearance, icon });
    props.onPick(icon);
    if (icon.kind === 'emoji') recordEmojiUsage(icon.value);
  };
  function nextGridOption(
    options: HTMLButtonElement[],
    index: number,
    key: string
  ) {
    const forward = key === 'ArrowRight' || key === 'ArrowDown';
    if (index < 0) return forward ? options[0] : options.at(-1);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      return options[
        Math.max(0, Math.min(options.length - 1, index + (forward ? 1 : -1)))
      ];
    }
    const groups = Array.from(
      grid?.querySelectorAll('[data-appearance-grid]') ?? []
    ).map((group) =>
      Array.from(
        group.querySelectorAll<HTMLButtonElement>('[data-appearance-option]')
      )
    );
    const current = options[index];
    const groupIndex = groups.findIndex((group) => group.includes(current));
    const group = groups[groupIndex];
    if (!group) return current;
    const position = group.indexOf(current);
    const columns = props.mobile ? 8 : 9;
    const direction = forward ? 1 : -1;
    const next = position + direction * columns;
    if (next >= 0 && next < group.length) return group[next];
    // A short final row still belongs to this section.
    if (
      forward &&
      Math.floor(position / columns) < Math.floor((group.length - 1) / columns)
    )
      return group.at(-1);
    const adjacent = groups[groupIndex + direction];
    if (!adjacent) return current;
    const rowStart = forward
      ? 0
      : Math.floor((adjacent.length - 1) / columns) * columns;
    return adjacent[
      Math.min(adjacent.length - 1, rowStart + (position % columns))
    ];
  }
  function handleKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
      return;
    const options = Array.from(
      grid?.querySelectorAll<HTMLButtonElement>('[data-appearance-option]') ??
        []
    );
    const index =
      event.target instanceof HTMLButtonElement
        ? options.indexOf(event.target)
        : -1;
    const input = event.target === searchElement;
    if (input && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
      return;
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (
      arrows.includes(event.key) &&
      options.length > 0 &&
      (input || index >= 0)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const next = nextGridOption(options, index, event.key);
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
    } else if (input && event.key === 'Enter' && options.length > 0) {
      event.preventDefault();
      options[0].click();
    } else if (!input && event.key.length === 1 && event.key !== ' ') {
      event.preventDefault();
      changeSearch(search() + event.key);
      searchElement?.focus();
    }
  }
  const selected = (icon: AppearanceIcon) =>
    JSON.stringify(props.appearance.icon) === JSON.stringify(icon);
  const option = (icon: AppearanceIcon, label: string) => (
    <Button
      variant="ghost"
      appearance="bare"
      size={props.mobile ? 'icon-lg' : 'icon-md'}
      class="max-w-full min-w-0 rounded-md aria-pressed:bg-hover aria-pressed:border-edge-muted not-touch:hover:bg-hover touch:min-w-0"
      data-appearance-option
      aria-label={label}
      aria-pressed={selected(icon)}
      tooltip={label}
      onClick={() => pick(icon)}
    >
      <Show
        when={icon.kind === 'macro'}
        fallback={
          <span class="emoji text-xl mobile:text-[26px]">
            {icon.kind === 'emoji' ? icon.value : ''}
          </span>
        }
      >
        <span class="size-4.5 mobile:size-5.5">
          <EntityIcon
            targetType={props.defaultIcon}
            appearance={{ ...props.appearance, icon }}
            size="fill"
          />
        </span>
      </Show>
    </Button>
  );
  const IconGrid = (gridProps: { icons: readonly AppearanceIcon[] }) => (
    <div
      data-appearance-grid
      class="grid grid-cols-9 auto-rows-9 place-items-center mobile:grid-cols-8 mobile:auto-rows-11"
    >
      <For each={gridProps.icons}>
        {(icon) =>
          option(
            icon,
            icon.kind === 'macro' ? iconLabel(icon.name) : icon.value
          )
        }
      </For>
    </div>
  );
  const EmojiGrid = (gridProps: { emojis: readonly SimpleEmoji[] }) => (
    <div
      data-appearance-grid
      class="grid grid-cols-9 auto-rows-9 place-items-center mobile:grid-cols-8 mobile:auto-rows-11"
    >
      <For each={gridProps.emojis}>
        {(emoji) =>
          option(
            { kind: 'emoji', value: emoji.emoji },
            iconLabel(emoji.slug.replaceAll('_', '-'))
          )
        }
      </For>
    </div>
  );
  const heading = (label: string) => (
    <h3 class="flex h-7 items-center px-1 text-xs text-ink-muted">{label}</h3>
  );

  return (
    <div
      class="flex min-h-0 w-86 max-w-full flex-col text-sm mobile:w-full mobile:flex-1"
      onKeyDown={handleKeyDown}
    >
      <div class="flex shrink-0 flex-col gap-3 p-3 mobile:px-4">
        <div class="flex items-center justify-between gap-2">
          <Show when={props.mobile}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                props.onChange({ ...props.appearance, icon: null })
              }
            >
              {t('appearance.remove')}
            </Button>
          </Show>
          <Tabs
            aria-label={t('appearance.source')}
            value={tab()}
            onChange={(value) => {
              setTab(value);
              changeSearch('');
            }}
            options={[
              { value: 'icons', label: t('appearance.icons') },
              { value: 'emoji', label: t('appearance.emoji') },
            ]}
            size="sm"
          />
          <Show
            when={props.mobile}
            fallback={
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  props.onChange({ ...props.appearance, icon: null })
                }
              >
                {t('appearance.remove')}
              </Button>
            }
          >
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t('appearance.done')}
            </Button>
          </Show>
        </div>
        <InputGroup size={props.mobile ? 'lg' : 'md'}>
          <InputGroup.Addon>
            <SearchIcon class="size-4" />
          </InputGroup.Addon>
          <InputGroup.Input
            ref={searchElement}
            aria-label={t(
              tab() === 'icons'
                ? 'appearance.searchIcons'
                : 'appearance.searchEmoji'
            )}
            placeholder={t(
              tab() === 'icons'
                ? 'appearance.searchIcons'
                : 'appearance.searchEmoji'
            )}
            value={search()}
            onInput={(event) => changeSearch(event.currentTarget.value)}
          />
          <Show when={search().length > 0}>
            <InputGroup.Addon align="inline-end">
              <InputGroup.Button
                size="icon-xs"
                aria-label={t('appearance.clearSearch')}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  changeSearch('');
                  searchElement?.focus();
                }}
              >
                <XIcon class="size-3" />
              </InputGroup.Button>
            </InputGroup.Addon>
          </Show>
        </InputGroup>
        <Show when={tab() === 'icons'}>
          <div
            class="grid grid-cols-10 place-items-center"
            role="group"
            aria-label={t('appearance.color')}
          >
            <For each={[null, ...APPEARANCE_COLORS]}>
              {(color) => (
                <Button
                  variant="ghost"
                  appearance="bare"
                  size="icon-md"
                  class="w-full min-w-0 touch:min-w-0"
                  aria-label={
                    color === null
                      ? t('appearance.defaultColor')
                      : t(`appearance.${color}`)
                  }
                  aria-pressed={(props.appearance.color ?? null) === color}
                  tooltip={
                    color === null
                      ? t('appearance.defaultColor')
                      : t(`appearance.${color}`)
                  }
                  onClick={() => props.onChange({ ...props.appearance, color })}
                >
                  <span
                    class={
                      getIconConfig(props.defaultIcon ?? 'default').foreground
                    }
                    style={{ color: appearanceColor(color) }}
                  >
                    <span
                      class="block size-4 rounded-full mobile:size-5.5"
                      classList={{
                        'border-2 border-current': color === null,
                        'bg-current': color !== null,
                      }}
                      style={{
                        outline:
                          (props.appearance.color ?? null) === color
                            ? '2px solid currentColor'
                            : undefined,
                        'outline-offset': '2px',
                      }}
                    />
                  </span>
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div
        ref={grid}
        onScroll={updateCategoryFromScroll}
        class="h-76 min-h-0 overflow-y-auto overscroll-contain border-t border-edge-muted px-3 pb-2 mobile:h-auto mobile:flex-1 mobile:px-4"
        data-icon-motion="none"
      >
        <Show
          when={searching()}
          fallback={
            <Show
              when={tab() === 'icons'}
              fallback={
                <For each={EMOJI_CATEGORIES}>
                  {(item) => {
                    const emojis = () =>
                      emojiGroups().find((group) => group.id === item.id)
                        ?.emojis ?? [];
                    return (
                      <Show when={emojis().length > 0}>
                        <section
                          ref={(element) =>
                            sectionElements.set(item.id, element)
                          }
                        >
                          {heading(t(`appearance.section_${item.id}`))}
                          <EmojiGrid emojis={emojis()} />
                        </section>
                      </Show>
                    );
                  }}
                </For>
              }
            >
              <Show when={recentMacros().length > 0}>
                {heading(t('appearance.section_recent'))}
                <IconGrid icons={recentMacros()} />
              </Show>
              <For each={ICON_SECTIONS}>
                {(section) => (
                  <section>
                    {heading(t(`appearance.section_${section.id}`))}
                    <IconGrid
                      icons={section.names.map((name) => ({
                        kind: 'macro',
                        name,
                      }))}
                    />
                  </section>
                )}
              </For>
            </Show>
          }
        >
          <Show when={tab() === 'icons' && names().length > 0}>
            {heading(t('appearance.iconCount', { count: names().length }))}
            <IconGrid
              icons={names().map((name) => ({ kind: 'macro', name }))}
            />
          </Show>
          <Show when={emojiData.emojis().length > 0}>
            {heading(
              t('appearance.emojiCount', { count: emojiData.emojis().length })
            )}
            <EmojiGrid emojis={emojiData.emojis()} />
          </Show>
          <Show
            when={
              (tab() === 'emoji' || names().length === 0) &&
              emojiData.emojis().length === 0
            }
          >
            <p class="p-4 text-center text-ink-muted">
              {t('appearance.noMatches')}
            </p>
          </Show>
        </Show>
      </div>
      <Show when={props.error}>
        <p role="alert" class="px-4 py-2 text-xs text-failure">
          {props.error}
        </p>
      </Show>
      <Show
        when={tab() === 'emoji'}
        fallback={
          <div class="flex shrink-0 items-center gap-2 border-t border-edge-muted px-4 py-3 text-xs text-ink-muted">
            <UsersIcon class="size-3" />
            {t('appearance.shared')}
          </div>
        }
      >
        <div
          class="grid shrink-0 grid-cols-9 place-items-center border-t border-edge-muted p-2"
          role="group"
          aria-label={t('appearance.categories')}
        >
          <For each={EMOJI_CATEGORIES}>
            {(item) => (
              <Button
                variant="ghost"
                size={props.mobile ? 'icon-lg' : 'icon-md'}
                class="max-w-full min-w-0 touch:min-w-0"
                aria-label={t(`appearance.section_${item.id}`)}
                aria-pressed={!searching() && category() === item.id}
                disabled={item.id === 'recent' && recentEmojis().length === 0}
                tooltip={t(`appearance.section_${item.id}`)}
                onClick={() => {
                  changeSearch('');
                  setCategory(item.id);
                  sectionElements
                    .get(item.id)
                    ?.scrollIntoView({ block: 'start' });
                }}
              >
                <Dynamic component={item.icon} class="size-4 mobile:size-5" />
              </Button>
            )}
          </For>
        </div>
      </Show>
      <span class="sr-only" aria-live="polite">
        {props.saving ? t('appearance.saving') : ''}
      </span>
    </div>
  );
}
