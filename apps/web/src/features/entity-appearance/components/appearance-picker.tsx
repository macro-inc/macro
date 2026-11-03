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
import { Key } from '@solid-primitives/keyed';
import { Button, InputGroup, Tabs } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import {
  APPEARANCE_COLORS,
  appearanceColor,
  type EntityAppearance,
} from '../core/appearance';
import {
  ICON_SECTIONS,
  iconLabel,
  isPickerIconName,
  PICKER_ICON_LABELS,
  PICKER_ICON_NAMES,
} from '../core/catalog';
import {
  nextPickerOption,
  type PickerOption,
  type PickerSection,
  pickerRows,
} from '../core/picker-grid';

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
  const [category, setCategory] = createSignal(
    props.recent.some((icon) => icon.kind === 'emoji') ? 'recent' : 'people'
  );
  const [focusedKey, setFocusedKey] = createSignal<string>();
  const [focusRequest, setFocusRequest] = createSignal<string>();
  const emojiData = useEmojiData({ minimumSearchLength: 1 });
  let searchElement: HTMLInputElement | undefined;
  let grid: HTMLDivElement | undefined;
  const searching = () => search().trim().length > 0;
  const macroLabel = (name: string) =>
    isPickerIconName(name) ? t(`entityIcons.icon_${name}`) : iconLabel(name);
  const names = createMemo(() => {
    const words = search()
      .trim()
      .toLowerCase()
      .split(/[\s-]+/);
    return PICKER_ICON_NAMES.filter((name) => {
      const searchable =
        `${name} ${PICKER_ICON_LABELS.get(name)} ${macroLabel(name)}`.toLowerCase();
      return words.every((word) => searchable.includes(word));
    });
  });
  const columns = () => (props.mobile ? 8 : 9);
  const option = (
    section: string,
    icon: AppearanceIcon,
    label: string
  ): PickerOption => ({
    key: `${section}:${JSON.stringify(icon)}`,
    icon,
    label,
  });
  const macroOptions = (section: string, names: readonly string[]) =>
    names.map((name) =>
      option(section, { kind: 'macro', name }, macroLabel(name))
    );
  const emojiOptions = (section: string, emojis: readonly SimpleEmoji[]) =>
    emojis.map((emoji) =>
      option(
        section,
        { kind: 'emoji', value: emoji.emoji },
        iconLabel(emoji.slug.replaceAll('_', '-'))
      )
    );
  const recentEmojis = () =>
    props.recent.filter((icon) => icon.kind === 'emoji');
  const sections = createMemo((): PickerSection[] => {
    if (searching())
      return [
        ...(tab() === 'icons'
          ? [
              {
                key: 'icons',
                label: t('appearance.iconCount', { count: names().length }),
                options: macroOptions('icons', names()),
              },
            ]
          : []),
        {
          key: 'emoji',
          label: t('appearance.emojiCount', {
            count: emojiData.emojis().length,
          }),
          options: emojiOptions('emoji', emojiData.emojis()),
        },
      ];
    const recent = props.recent.filter(
      (icon) => icon.kind === (tab() === 'icons' ? 'macro' : 'emoji')
    );
    const recentSection = {
      key: 'recent',
      label: t('appearance.section_recent'),
      options: recent.map((icon) =>
        option(
          'recent',
          icon,
          icon.kind === 'macro' ? macroLabel(icon.name) : icon.value
        )
      ),
    };
    if (tab() === 'icons')
      return [
        recentSection,
        ...ICON_SECTIONS.map((section) => ({
          key: section.id,
          label: t(`entityIcons.section_${section.id}`),
          options: macroOptions(
            section.id,
            section.icons.map(({ name }) => name)
          ),
        })),
      ];
    const groups = emojiData.groups();
    return [
      recentSection,
      ...EMOJI_CATEGORIES.filter((category) => category.id !== 'recent').map(
        (category) => ({
          key: category.id,
          label: t(`appearance.section_${category.id}`),
          options: emojiOptions(
            category.id,
            groups
              .filter((group) => category.groups.includes(group.name))
              .flatMap((group) => group.emojis)
          ),
        })
      ),
    ];
  });
  const rows = createMemo(() => pickerRows(sections(), columns()));
  const rowKeys = createMemo(() => rows().map((row) => row.key));
  const focusedRow = createMemo(() =>
    rows().findIndex(
      (row) =>
        row.kind === 'options' &&
        row.options.some((option) => option.key === focusedKey())
    )
  );
  const keptRows = createMemo(() => (focusedRow() < 0 ? [] : [focusedRow()]));
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const restoreRequestedFocus = () => {
    const requested = focusRequest();
    if (!requested) return;
    const button = Array.from(
      grid?.querySelectorAll<HTMLButtonElement>('[data-appearance-option]') ??
        []
    ).find((button) => button.dataset.appearanceOption === requested);
    if (button) {
      button.focus({ preventScroll: true });
      setFocusRequest(undefined);
    }
  };
  createEffect(on([focusRequest, rows, virtualizer], restoreRequestedFocus));
  const changeSearch = (value: string) => {
    setFocusedKey(undefined);
    setFocusRequest(undefined);
    setSearch(value);
    emojiData.filter(value);
    setCategory(
      sections().find((section) => section.options.length > 0)?.key ?? 'people'
    );
    virtualizer()?.scrollTo(0);
  };
  const updateCategoryFromScroll = (offset: number) => {
    if (tab() !== 'emoji' || searching()) return;
    const index = virtualizer()?.findItemIndex(offset);
    if (index !== undefined && rows()[index])
      setCategory(rows()[index].section);
  };
  const pick = (option: PickerOption, button?: HTMLButtonElement) => {
    const preserveFocus = button === document.activeElement;
    props.onChange({ ...props.appearance, icon: option.icon });
    props.onPick(option.icon);
    if (option.icon.kind === 'emoji') recordEmojiUsage(option.icon.value);
    if (preserveFocus) {
      setFocusedKey(option.key);
      setFocusRequest(option.key);
    }
  };
  const focusOption = (option: PickerOption) => {
    setFocusedKey(option.key);
    setFocusRequest(option.key);
    const index = focusedRow();
    if (index >= 0) virtualizer()?.scrollToIndex(index, { align: 'nearest' });
  };
  function handleKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
      return;
    const input = event.target === searchElement;
    if (input && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
      return;
    const current =
      event.target instanceof HTMLElement
        ? event.target.dataset.appearanceOption
        : undefined;
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
      (input || current)
    ) {
      const next = nextPickerOption(rows(), current, event.key);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      focusOption(next);
    } else if (input && event.key === 'Enter') {
      const first = nextPickerOption(rows(), undefined, 'ArrowDown');
      if (!first) return;
      event.preventDefault();
      pick(first);
    } else if (!input && event.key.length === 1 && event.key !== ' ') {
      event.preventDefault();
      changeSearch(search() + event.key);
      searchElement?.focus();
    }
  }
  const selected = (icon: AppearanceIcon) =>
    JSON.stringify(props.appearance.icon) === JSON.stringify(icon);
  const Option = (optionProps: { option: PickerOption }) => {
    onMount(restoreRequestedFocus);
    return (
      <Button
        variant="ghost"
        appearance="bare"
        size={props.mobile ? 'icon-lg' : 'icon-md'}
        class="max-w-full min-w-0 rounded-md aria-pressed:bg-hover aria-pressed:border-edge-muted not-touch:hover:bg-hover touch:min-w-0"
        data-appearance-option={optionProps.option.key}
        aria-label={optionProps.option.label}
        aria-pressed={selected(optionProps.option.icon)}
        tooltip={optionProps.option.label}
        onClick={(event) => pick(optionProps.option, event.currentTarget)}
      >
        <Show
          when={optionProps.option.icon.kind === 'macro'}
          fallback={
            <span class="emoji text-xl mobile:text-[26px]">
              {optionProps.option.icon.kind === 'emoji'
                ? optionProps.option.icon.value
                : ''}
            </span>
          }
        >
          <span class="size-4.5 mobile:size-5.5">
            <EntityIcon
              targetType={props.defaultIcon}
              appearance={{
                ...props.appearance,
                icon: optionProps.option.icon,
              }}
              size="fill"
            />
          </span>
        </Show>
      </Button>
    );
  };

  return (
    <div
      class="flex min-h-0 w-86 max-w-full flex-col text-sm mobile:w-full mobile:flex-1"
      onKeyDown={handleKeyDown}
      onFocusIn={(event) => {
        const key =
          event.target instanceof HTMLElement
            ? event.target.dataset.appearanceOption
            : undefined;
        setFocusedKey(key);
        if (!key) setFocusRequest(undefined);
      }}
      onFocusOut={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setFocusedKey(undefined);
          setFocusRequest(undefined);
        }
      }}
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
            class="grid grid-cols-[repeat(auto-fit,minmax(2.75rem,1fr))] place-items-center gap-y-1"
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
        data-appearance-scroll
        class="h-76 min-h-0 overflow-y-auto overscroll-contain border-t border-edge-muted px-3 pb-2 mobile:h-auto mobile:flex-1 mobile:px-4"
        data-icon-motion="none"
      >
        <Virtualizer
          data={rowKeys()}
          ref={setVirtualizer}
          itemSize={props.mobile ? 44 : 36}
          bufferSize={108}
          keepMounted={keptRows()}
          onScroll={updateCategoryFromScroll}
        >
          {(_, index) => {
            const row = () => rows()[index()];
            const options = () => {
              const current = row();
              return current?.kind === 'options' ? current.options : [];
            };
            const label = () => {
              const current = row();
              return current?.kind === 'heading' ? current.label : '';
            };
            return (
              <div
                data-appearance-row={index()}
                style={{
                  height: `${row()?.kind === 'heading' ? 28 : props.mobile ? 44 : 36}px`,
                }}
              >
                <Show
                  when={row()?.kind === 'heading'}
                  fallback={
                    <div
                      class="grid h-full grid-cols-9 place-items-center mobile:grid-cols-8"
                      data-appearance-grid
                    >
                      <Key each={options()} by="key">
                        {(option) => <Option option={option()} />}
                      </Key>
                    </div>
                  }
                >
                  <h3 class="flex h-full items-center px-1 text-xs text-ink-muted">
                    {label()}
                  </h3>
                </Show>
              </div>
            );
          }}
        </Virtualizer>
        <Show when={searching() && rows().length === 0}>
          <p class="p-4 text-center text-ink-muted">
            {t('appearance.noMatches')}
          </p>
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
                  const index = rows().findIndex(
                    (row) => row.kind === 'heading' && row.section === item.id
                  );
                  if (index >= 0)
                    virtualizer()?.scrollToIndex(index, { align: 'start' });
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
