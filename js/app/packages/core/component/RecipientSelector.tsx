import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { EntityIcon } from '@core/component/EntityIcon';
import { HoverCard } from '@core/component/HoverCard';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { UserTooltip } from '@core/component/UserTooltip';
import { useEmail, useUserId } from '@core/context/user';
import {
  type CombinedRecipientItem,
  type CombinedRecipientKind,
  type CustomUserInput,
  emailToId,
  recipientEntityMapper,
  type WithCustomUserInput,
} from '@core/user';
import { useAugmentUserWithDmActivity } from '@core/user/dmActivity';
import { createFreshSearch, FreshSearchPresets } from '@core/util/freshSort';
import { matches } from '@core/util/match';
import { clamp } from '@core/util/math';
import { truncateString } from '@core/util/string';
import type { CollectionNode } from '@kobalte/core';
import {
  Combobox,
  type ComboboxTriggerMode,
  useComboboxContext,
} from '@kobalte/core/combobox';
import CheckIcon from '@phosphor/check.svg';
import HashIcon from '@phosphor/hash.svg';
import XIcon from '@phosphor/x.svg';
import { debounce } from '@solid-primitives/scheduled';
import { cn, Layer } from '@ui';
import * as EmailValidator from 'email-validator';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';

function ChipWithUserTooltip(props: {
  chip: JSX.Element;
  renderTooltip: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <HoverCard
      placement="bottom"
      open={open()}
      onOpenChange={setOpen}
      triggerAs="div"
      trigger={props.chip}
      content={props.renderTooltip(() => setOpen(false))}
    />
  );
}

function RecipientChip(props: {
  icon?: JSX.Element;
  label: string;
  onRemove: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
}) {
  return (
    <div
      class="flex flex-row shrink-0 py-1 pl-2 gap-1 pr-1 overflow-hidden items-center bg-active rounded-full"
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
    >
      <Show when={props.icon}>{props.icon}</Show>
      <p class="text-sm whitespace-nowrap">{truncateString(props.label, 20)}</p>
      <XIcon
        class="size-5 hover:bg-hover hover:text-failure p-1 rounded-full"
        onClick={props.onRemove}
      />
    </div>
  );
}

function getRecipientOptionEmail(
  option: CombinedRecipientItem
): string | undefined {
  switch (option.kind) {
    case 'user':
      return option.data.email;
    case 'channel':
      return undefined;
    case 'contact':
      return option.data.email;
    case 'custom':
      return option.data.email;
  }
}

function getRecipientOptionName(option: CombinedRecipientItem) {
  switch (option.kind) {
    case 'user':
      const name = option.data.name;
      if (name && name !== option.data.email) return name;
      return undefined;
    case 'channel':
      return option.data.name;
    case 'contact':
      return option.data.name;
    case 'custom':
      return undefined;
  }
}

function getRecipientOptionValue(option: CombinedRecipientItem) {
  switch (option.kind) {
    case 'user':
      return `user-${option.data.id}`;
    case 'channel':
      return `channel-${option.data.id}`;
    case 'contact':
      return `contact-${option.data.email}`;
    case 'custom':
      return `current-user-input-${option.data.email}`;
  }
}

function getRecipientOptionLabel(option: CombinedRecipientItem) {
  switch (option.kind) {
    case 'user':
      return option.data.email;
    case 'channel':
      return option.data.id;
    case 'contact':
      return option.data.email;
    case 'custom':
      return option.data.email;
  }
}

function getRecipientOptionTextValue(option: CombinedRecipientItem) {
  const name = getRecipientOptionName(option);
  const email = getRecipientOptionEmail(option);
  switch (option.kind) {
    case 'user':
    case 'contact':
      return name ? `${name} ${email}` : (email ?? '');
    case 'channel':
      return option.data.name ?? '';
    case 'custom':
      return option.data.email;
  }
}

type RecipientComboboxItemProps = CollectionNode<CombinedRecipientItem>;

function RecipientComboboxItem(props: RecipientComboboxItemProps): JSX.Element {
  const handleMouseEnter = () => {
    const items = document.querySelectorAll('[data-highlighted]');
    items.forEach((item) => {
      item.removeAttribute('data-highlighted');
      item.setAttribute('data-highlighted-temp', '');
    });
  };

  const handleMouseLeave = () => {
    const items = document.querySelectorAll('[data-highlighted-temp]');
    items.forEach((item) => {
      item.removeAttribute('data-highlighted-temp');
      item.setAttribute('data-highlighted', '');
    });
  };

  return (
    <Combobox.Item
      item={props}
      class={cn(
        'flex flex-row p-2 mb-1 rounded-md justify-between items-center data-highlighted:bg-hover',
        props.disabled && 'hover:bg-hover'
      )}
      onMouseEnter={props.disabled ? handleMouseEnter : undefined}
      onMouseLeave={props.disabled ? handleMouseLeave : undefined}
    >
      <Switch>
        <Match
          when={matches(
            props.rawValue,
            (i) =>
              i.kind === 'user' || i.kind === 'contact' || i.kind === 'custom'
          )}
        >
          {(item) => {
            const option = item();
            const name = getRecipientOptionName(option);
            const email = getRecipientOptionEmail(option);

            const contactInfo =
              name && name !== email ? `${name} | ${email}` : email;

            // Use appropriate id for UserIcon based on type
            const iconId = props.disabled ? '?' : option.id;

            return (
              <Combobox.ItemLabel class="flex flex-row w-full items-center gap-1.5 text-ink-muted select-none text-sm">
                <UserIcon id={iconId ?? ''} size="md" isDeleted={false} />
                <p
                  class={cn(
                    'ph-no-capture truncate my-auto',
                    props.disabled && 'italic'
                  )}
                >
                  {contactInfo}
                </p>
              </Combobox.ItemLabel>
            );
          }}
        </Match>
        <Match when={matches(props.rawValue, (i) => i.kind === 'channel')}>
          {(item) => {
            return (
              <Combobox.ItemLabel class="flex flex-row w-full gap-1.5 text-ink-muted select-none text-sm">
                <div class="flex flex-col items-center justify-center p-1">
                  <EntityIcon
                    targetType={item().data.channel_type || 'channel'}
                  />
                </div>
                <p class={'ph-no-capture truncate my-auto'}>
                  {item().data.name}
                </p>
              </Combobox.ItemLabel>
            );
          }}
        </Match>
      </Switch>

      <Combobox.ItemIndicator>
        <CheckIcon class="size-4" />
      </Combobox.ItemIndicator>
    </Combobox.Item>
  );
}

type RecipientSelectorProps<K extends CombinedRecipientKind> = {
  options: Accessor<CombinedRecipientItem<K>[]>;
  selectedOptions: WithCustomUserInput<K>[];
  setSelectedOptions: (next: WithCustomUserInput<K>[]) => void;
  // If you provide triedToSubmit, the component will show an error message if no options are selected and triedToSubmit is true
  triedToSubmit?: Accessor<boolean>;
  placeholder?: string | JSX.Element;
  inputRef?: (ref: HTMLInputElement) => void;
  focusOnMount?: boolean;
  triggerMode?: ComboboxTriggerMode;
  hideBorder?: boolean;
  noPadding?: boolean;
  includeSelf?: boolean;
  selfEmail?: string;
  disabled?: boolean;
  onChipDragStart?: (option: WithCustomUserInput<K>, e: DragEvent) => void;
  onChipDragEnd?: (e: DragEvent) => void;
  horizontalScroll?: boolean;
  class?: string;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
};

export function RecipientSelector<K extends CombinedRecipientKind>(
  props: RecipientSelectorProps<K>
): JSX.Element {
  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();
  const [inputValue, setInputValue] = createSignal('');
  const [customUsers, setCustomUsers] = createSignal<WithCustomUserInput<K>[]>(
    []
  );
  const [disabled, setDisabled] = createSignal(false);

  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();

  const debouncedHandleChange = debounce(handleChange, 100);

  const [isOpen, setIsOpen] = createSignal<boolean>();

  const hasValidCustomEmail = () => {
    const input = inputValue();
    if (!input || !EmailValidator.validate(input)) return false;
    return true;
  };

  createEffect(() => {
    if (hasValidCustomEmail()) {
      setIsOpen(true);
    }
  });

  if (props.focusOnMount) {
    onMount(() => {
      setTimeout(() => {
        inputRef()?.focus();
      }, 0);
    });
  }

  function getOptionDisabled(option: CombinedRecipientItem): boolean {
    if (option.kind === 'custom') {
      return option.data.invalid;
    }
    return false;
  }

  const placeholderText = () => {
    return props.selectedOptions.length === 0
      ? 'Select recipients'
      : 'select more recipients';
  };

  const userId = useUserId();
  const userEmail = useEmail();
  const selfEmail = () => (props.selfEmail ?? userEmail())?.toLowerCase();
  const selfId = () =>
    props.selfEmail ? emailToId(props.selfEmail) : userId();

  function handleChange(value: CombinedRecipientItem[]) {
    let newestSelection = value.at(-1);
    if (!newestSelection) {
      setCustomUsers([]);
      props.setSelectedOptions([]);
      return;
    }

    if (
      !props.includeSelf &&
      newestSelection.kind === 'user' &&
      newestSelection.id === selfId()
    ) {
      const inputEl = inputRef();
      if (inputEl) inputEl.value = '';

      return toast.failure('You cannot add yourself');
    }

    // We can only select one channel at a time
    if (newestSelection.kind === 'channel') {
      props.setSelectedOptions(value as CombinedRecipientItem<K>[]);
      return;
    }

    if (
      newestSelection.kind === 'user' ||
      newestSelection.kind === 'contact' ||
      newestSelection.kind === 'custom'
    ) {
      setCustomUsers(
        value.filter((o) => {
          if (o.kind === 'custom') {
            return o.data.invalid === false;
          }
          return false;
        }) as WithCustomUserInput<K>[]
      );
      props.setSelectedOptions(value as CombinedRecipientItem<K>[]);
      return;
    }
  }

  const invalid = createMemo(
    () =>
      (props.triedToSubmit?.() ?? false) && props.selectedOptions.length === 0
  );

  const currentUserEmail = useEmail();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  // Create search function for recipients - only used for initial sorting with no query
  const recipientSearch = createFreshSearch<CombinedRecipientItem>({
    config: FreshSearchPresets.baseUserSearch<CombinedRecipientItem>(
      currentUserDomain,
      getRecipientOptionEmail
    ),
    getName: getRecipientOptionTextValue,
    isChannelItem: (item) => item.kind === 'channel',
    getTimestamp: (item) => ({
      lastInteraction:
        item.kind === 'user' ? item.data.lastInteraction : undefined,
    }),
  });

  const selectedEmails = createMemo(() => {
    const set = new Set<string>();
    for (const option of props.selectedOptions) {
      const email = getRecipientOptionEmail(option as CombinedRecipientItem);
      if (email) set.add(email.toLowerCase());
    }
    return set;
  });

  const augmentUserWithDmActivity = useAugmentUserWithDmActivity();
  const recipients = createMemo(() => {
    const options: CombinedRecipientItem[] = [];
    const emails = new Set<string>();

    for (const option of props.options()) {
      const item = option as CombinedRecipientItem;
      const email = getRecipientOptionEmail(item);

      if (!props.includeSelf) {
        const emailLower = email?.toLowerCase();
        const matchesSelf =
          (item.kind === 'user' && item.id === selfId()) ||
          (item.kind === 'contact' &&
            !!emailLower &&
            emailLower === selfEmail());
        const isSelected = !!emailLower && selectedEmails().has(emailLower);
        if (matchesSelf && !isSelected) {
          continue;
        }
      }

      if (email) {
        emails.add(email.toLowerCase());
      }

      if (item.kind === 'user') {
        item.data = augmentUserWithDmActivity(item.data);
      }

      options.push(item);
    }

    const sorted = recipientSearch(options, '').map((item) => {
      return item.item;
    });

    return {
      raw: options,
      emails,
      sorted,
    };
  });

  const options = createMemo(() => {
    const { emails, sorted } = recipients();
    const currentUserInput = inputValue();

    // Check if currentUserInput matches any existing email
    const hasExactEmailMatch =
      currentUserInput && emails.has(currentUserInput.toLowerCase());

    const allOptions = [...sorted, ...customUsers()];

    // Only add custom input if it doesn't match an existing email
    if (
      currentUserInput &&
      !hasExactEmailMatch &&
      EmailValidator.validate(currentUserInput)
    ) {
      const customUserInput: CustomUserInput = {
        id: emailToId(currentUserInput),
        email: currentUserInput,
        invalid: !EmailValidator.validate(currentUserInput),
      };

      const customEntity = recipientEntityMapper('custom')(customUserInput);
      allOptions.push(customEntity);
    }

    return allOptions as CombinedRecipientItem<K>[];
  });

  const [scrollToItem, setScrollToItem] = createSignal<(key: string) => void>(
    () => {}
  );

  const selectedLen = () => props.selectedOptions.length;

  const onInputChange = (next: string) => {
    setInputValue(next);

    // Send the keydown event to the listbox so Kobalte's internal system can update the focus state
    // This makes it so it behaves the same as if you had manually pressed the down arrow to focus the item
    queueMicrotask(() => {
      listboxRef()?.dispatchEvent(
        // We need to send `bubbles: true` because otherwise Kobalte ignores the event
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
      );
    });
  };

  return (
    <Layer depth={props.depth ?? 2}>
      <Combobox<CombinedRecipientItem>
        multiple
        virtualized
        triggerMode={props.triggerMode ?? 'input'}
        closeOnSelection={true}
        open={isOpen()}
        onOpenChange={setIsOpen}
        disabled={props.disabled}
        validationState={invalid() ? 'invalid' : 'valid'}
        options={options() as CombinedRecipientItem[]}
        optionLabel={getRecipientOptionLabel}
        optionValue={getRecipientOptionValue}
        optionTextValue={getRecipientOptionTextValue}
        optionDisabled={getOptionDisabled}
        value={props.selectedOptions as CombinedRecipientItem[]}
        onChange={debouncedHandleChange}
        onInputChange={onInputChange}
        shouldFocusWrap
        placeholder={
          props.selectedOptions?.length === 0
            ? (props.placeholder ?? placeholderText())
            : undefined
        }
        class={cn(
          'ph-no-capture w-full text-sm offset-2 bg-surface rounded-2xl',
          !props.hideBorder && 'ring-1 ring-edge',
          !props.noPadding && 'p-2',
          props.class
        )}
      >
        <Combobox.Control<CombinedRecipientItem>>
          {(state) => {
            const context = useComboboxContext();
            const [chipsScrollRef, setChipsScrollRef] =
              createSignal<HTMLElement>();
            return (
              <div class="relative">
                <div
                  ref={props.horizontalScroll ? setChipsScrollRef : undefined}
                  class={cn(
                    'flex gap-1.5 text-ink scrollbar-hidden',
                    props.horizontalScroll
                      ? 'flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-x-hidden sm:max-h-37.5 sm:overflow-y-auto pb-0.5 sm:pb-0'
                      : 'flex-wrap max-h-37.5 overflow-y-auto'
                  )}
                >
                  <For each={state.selectedOptions()}>
                    {(option) => {
                      return (
                        <Switch>
                          <Match
                            when={matches(
                              option,
                              (o) => o.kind === 'user' || o.kind === 'contact'
                            )}
                          >
                            {(userOrContactOption) => {
                              const opt = userOrContactOption();
                              const name = getRecipientOptionName(opt);
                              const email = getRecipientOptionEmail(opt);

                              const displayText = () => name || email;

                              return (
                                <ChipWithUserTooltip
                                  chip={
                                    <RecipientChip
                                      icon={
                                        <UserIcon
                                          id={opt.id}
                                          size="sm"
                                          isDeleted={false}
                                          showTooltip={false}
                                        />
                                      }
                                      label={displayText() ?? ''}
                                      onRemove={() => state.remove(option)}
                                      draggable={!!props.onChipDragStart}
                                      onDragStart={(e) =>
                                        props.onChipDragStart?.(
                                          option as WithCustomUserInput<K>,
                                          e
                                        )
                                      }
                                      onDragEnd={props.onChipDragEnd}
                                    />
                                  }
                                  renderTooltip={(close) => (
                                    <UserTooltip
                                      displayName={name || ''}
                                      email={email}
                                      id={opt.id}
                                      isDeleted={false}
                                      onClose={close}
                                    />
                                  )}
                                />
                              );
                            }}
                          </Match>
                          <Match
                            when={matches(option, (o) => o.kind === 'channel')}
                          >
                            {(channelOption) => {
                              return (
                                <RecipientChip
                                  icon={<HashIcon class="size-4" />}
                                  label={
                                    channelOption().data.name ??
                                    channelOption().id
                                  }
                                  onRemove={() => state.remove(option)}
                                />
                              );
                            }}
                          </Match>
                          <Match
                            when={matches(option, (o) => o.kind === 'custom')}
                          >
                            {(customOption) => {
                              const email = customOption().data.email;

                              return (
                                <ChipWithUserTooltip
                                  chip={
                                    <RecipientChip
                                      icon={
                                        <UserIcon
                                          id={email}
                                          size="sm"
                                          isDeleted={false}
                                          showTooltip={false}
                                        />
                                      }
                                      label={email}
                                      onRemove={() => state.remove(option)}
                                      draggable={!!props.onChipDragStart}
                                      onDragStart={(e) =>
                                        props.onChipDragStart?.(
                                          option as WithCustomUserInput<K>,
                                          e
                                        )
                                      }
                                      onDragEnd={props.onChipDragEnd}
                                    />
                                  }
                                  renderTooltip={(close) => (
                                    <UserTooltip
                                      displayName={email}
                                      email={email}
                                      isDeleted={false}
                                      onClose={close}
                                    />
                                  )}
                                />
                              );
                            }}
                          </Match>
                        </Switch>
                      );
                    }}
                  </For>
                  <Combobox.Input
                    disabled={disabled()}
                    ref={(el) => {
                      setInputRef(el);
                      props.inputRef?.(el);
                    }}
                    class="flex-1 min-h-7 p-1 min-w-50 outline-none placeholder:text-ink-placeholder"
                    classList={{ 'ml-1': selectedLen() === 0 }}
                    onKeyDown={(e) => {
                      if (
                        (e.key === 'a' && e.ctrlKey) ||
                        (e.key === 'a' && e.metaKey)
                      ) {
                        setDisabled(true);
                        queueMicrotask(() => setDisabled(false));
                      }
                      if (e.key === 'Escape') {
                        if (inputValue().length === 0) {
                          inputRef()?.blur();
                        }
                      }
                    }}
                    // use a non-delegated event here so that we can process it before Kobalte
                    on:keydown={(e: KeyboardEvent) => {
                      if (e.key === 'Tab' && context.isOpen()) {
                        e.preventDefault();
                        e.stopPropagation();
                        inputRef()?.dispatchEvent(
                          // We need to send `bubbles: true` because otherwise Kobalte ignores the event
                          new KeyboardEvent('keydown', {
                            bubbles: true,
                            key: 'Enter',
                          })
                        );
                      }
                    }}
                  />
                </div>
                <Show when={props.horizontalScroll}>
                  <CustomScrollbar
                    scrollContainer={chipsScrollRef}
                    horizontal
                    class="sm:hidden"
                  />
                </Show>
              </div>
            );
          }}
        </Combobox.Control>

        <Combobox.Portal>
          <Layer depth={2}>
            <Combobox.Content class="z-modal-content bg-surface translate-y-1 border-edge p-1 rounded-lg shadow-lg shadow-drop-shadow ring ring-edge">
              <Combobox.Listbox
                ref={setListboxRef}
                class="flex flex-col gap-1"
                scrollToItem={scrollToItem()}
                autoFocus="first"
              >
                {(items) => {
                  const arr = Array.from(items());
                  const count = arr.length;
                  const height = clamp(count, 0, 6) * 36;

                  const [handle, setHandle] =
                    createSignal<VirtualizerHandle | null>(null);

                  setScrollToItem(() => (key: string) => {
                    const virtualizerHandle = handle();
                    if (virtualizerHandle) {
                      const ndx = arr.findIndex((item) => item.key === key);
                      if (ndx > -1) {
                        virtualizerHandle.scrollToIndex(ndx, {
                          align: 'nearest',
                        });
                      }
                    }
                  });

                  return (
                    <VList
                      data={arr}
                      style={{
                        height: `${height}px`,
                      }}
                      ref={setHandle}
                    >
                      {(item) => {
                        return <RecipientComboboxItem {...item} />;
                      }}
                    </VList>
                  );
                }}
              </Combobox.Listbox>
            </Combobox.Content>
          </Layer>
        </Combobox.Portal>
        <Combobox.ErrorMessage class="text-xs text-failure mt-1">
          *At least one participant is required
        </Combobox.ErrorMessage>
      </Combobox>
    </Layer>
  );
}
