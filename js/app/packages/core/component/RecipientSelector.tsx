import { CustomEntityIcon } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import {
  type CombinedRecipientItem,
  type CombinedRecipientKind,
  type CustomUserInput,
  emailToId,
  recipientEntityMapper,
  type WithCustomUserInput,
} from '@core/user';
import { matches } from '@core/util/match';
import { clamp } from '@core/util/math';
import { truncateString } from '@core/util/string';
import BuildingIcon from '@icon/duotone/building-office-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import CheckIcon from '@icon/regular/check.svg';
import HashIcon from '@icon/regular/hash.svg';
import XIcon from '@icon/regular/x.svg';
import type { CollectionNode } from '@kobalte/core';
import { Combobox, type ComboboxTriggerMode } from '@kobalte/core/combobox';
import type { Channel } from '@service-comms/generated/models/channel';
import { useEmail, useUserId } from '@service-gql/client';
import { debounce } from '@solid-primitives/scheduled';
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
  type Setter,
  Switch,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';

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
  function channelTypeIcon(channel: Channel) {
    switch (channel.channel_type) {
      case 'direct_message':
        return UserIcon;
      case 'private':
        return ThreeUsersIcon;
      case 'organization':
        return BuildingIcon;
      case 'public':
        return GlobeIcon;
      default:
        return HashIcon;
    }
  }

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
      class={`flex flex-row px-2 py-1 mb-1 justify-between items-center data-highlighted:bg-hover hover-transition-bg
        ${props.disabled ? ' hover:bg-hover hover-transition-bg' : ''}`}
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
                <UserIcon id={iconId ?? ''} size="sm" isDeleted={false} />
                <p class={`truncate my-auto ${props.disabled ? 'italic' : ''}`}>
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
                  <CustomEntityIcon
                    icon={channelTypeIcon(item().data)}
                    size="xs"
                  />
                </div>
                <p class={'truncate my-auto'}>{item().data.name}</p>
              </Combobox.ItemLabel>
            );
          }}
        </Match>
      </Switch>

      <Combobox.ItemIndicator>
        <CheckIcon class="w-4 h-4" />
      </Combobox.ItemIndicator>
    </Combobox.Item>
  );
}

type RecipientSelectorProps<K extends CombinedRecipientKind> = {
  options: Accessor<CombinedRecipientItem<K>[]>;
  selectedOptions: Accessor<WithCustomUserInput<K>[]>;
  setSelectedOptions: Setter<WithCustomUserInput<K>[]>;
  // If you provide triedToSubmit, the component will show an error message if no options are selected and triedToSubmit is true
  triedToSubmit?: Accessor<boolean>;
  placeholder?: string | JSX.Element;
  inputRef?: Setter<HTMLInputElement | undefined>;
  focusOnMount?: boolean;
  triggerMode?: ComboboxTriggerMode;
  hideBorder?: boolean;
  noPadding?: boolean;
  noBrackets?: boolean;
  includeSelf?: boolean;
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

  if (props.inputRef) {
    createEffect(() => {
      const ref = inputRef();
      if (props.inputRef && ref) {
        props.inputRef(ref);
      }
    });
  }

  function getOptionDisabled(option: CombinedRecipientItem): boolean {
    if (option.kind === 'custom') {
      return option.data.invalid;
    }
    return false;
  }

  const placeholderText = () => {
    return props.selectedOptions().length === 0
      ? 'Select recipients'
      : 'select more recipients';
  };

  const userId = useUserId();
  const userEmail = useEmail();

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
      newestSelection.id === userId()
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
          return true;
        }) as WithCustomUserInput<K>[]
      );
      props.setSelectedOptions(value as CombinedRecipientItem<K>[]);
      return;
    }
  }

  const invalid = createMemo(
    () =>
      (props.triedToSubmit?.() ?? false) && props.selectedOptions().length === 0
  );

  const options = createMemo(() => {
    const emailSet = new Set<string>();

    const optionsList: CombinedRecipientItem<K>[] = [];
    for (const option of props.options()) {
      const item = option as CombinedRecipientItem;
      const email = getRecipientOptionEmail(item);

      if (!props.includeSelf) {
        const matchesSelf =
          (item.kind === 'user' && item.id === userId()) ||
          (item.kind === 'contact' && email === userEmail()?.toLowerCase());
        if (matchesSelf) {
          continue;
        }
      }

      if (email) {
        emailSet.add(email.toLowerCase());
      }
      optionsList.push(option);
    }

    const currentUserInput = inputValue();

    // Check if currentUserInput matches any existing email
    const hasExactEmailMatch =
      currentUserInput && emailSet.has(currentUserInput.toLowerCase());

    const allOptions = [...optionsList, ...customUsers()];

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

    return allOptions;
  });

  const [scrollToItem, setScrollToItem] = createSignal<(key: string) => void>(
    () => {}
  );
  const selectedLen = () => props.selectedOptions().length;

  return (
    <Combobox<CombinedRecipientItem>
      multiple
      virtualized
      triggerMode={props.triggerMode ?? 'input'}
      closeOnSelection={true}
      open={isOpen()}
      onOpenChange={setIsOpen}
      validationState={invalid() ? 'invalid' : 'valid'}
      options={options() as CombinedRecipientItem[]}
      optionLabel={getRecipientOptionLabel}
      optionValue={getRecipientOptionValue}
      optionTextValue={getRecipientOptionTextValue}
      optionDisabled={getOptionDisabled}
      value={props.selectedOptions() as CombinedRecipientItem[]}
      onChange={debouncedHandleChange}
      onInputChange={setInputValue}
      placeholder={
        props.selectedOptions()?.length === 0
          ? (props.placeholder ?? placeholderText())
          : undefined
      }
      class="w-full text-sm offset-2"
      classList={{
        'border border-edge': !props.hideBorder,
        'py-2': !props.noPadding,
        'focus-within:bracket-offset-2': !props.noBrackets,
      }}
    >
      <Combobox.Control<CombinedRecipientItem>>
        {(state) => (
          <div class="flex flex-wrap gap-1.5 max-h-[150px] overflow-y-auto text-ink">
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
                        console.log('OPT', userOrContactOption());
                        const opt = userOrContactOption();
                        const name = getRecipientOptionName(opt);
                        const email = getRecipientOptionEmail(opt);

                        const displayText =
                          name && name !== email ? `${name} | ${email}` : email;

                        return (
                          <div class="flex flex-row ml-2 py-1 pl-2 gap-1 pr-0.5 overflow-hidden items-center bg-hover">
                            <UserIcon id={opt.id} size="xs" isDeleted={false} />
                            <p class={'text-sm'}>
                              {truncateString(displayText ?? '', 20)}
                            </p>
                            <XIcon
                              class="w-5 h-5 cursor-pointer hover:bg-hover hover-transition-bg p-1 "
                              onClick={() => state.remove(option)}
                            />
                          </div>
                        );
                      }}
                    </Match>
                    <Match when={matches(option, (o) => o.kind === 'channel')}>
                      {(channelOption) => {
                        return (
                          <div class="flex flex-row ml-2 py-1 pl-2 gap-1 pr-0.5 overflow-hidden items-center bg-hover">
                            <HashIcon class="w-4 h-4" />
                            <p class={'text-sm'}>
                              {truncateString(
                                channelOption().data.name ?? channelOption().id,
                                20
                              )}
                            </p>
                            <XIcon
                              class="w-5 h-5 cursor-pointer hover:bg-hover hover-transition-bg p-1 "
                              onClick={() => state.remove(option)}
                            />
                          </div>
                        );
                      }}
                    </Match>
                    <Match when={matches(option, (o) => o.kind === 'custom')}>
                      {(customOption) => {
                        const email = customOption().data.email;
                        return (
                          <div class="flex flex-row ml-2 py-1 pl-2 gap-1 pr-0.5 overflow-hidden items-center bg-hover">
                            <UserIcon id={email} size="xs" isDeleted={false} />
                            <p class={'text-sm'}>{truncateString(email, 20)}</p>
                            <XIcon
                              class="w-5 h-5 cursor-pointer hover:bg-hover hover-transition-bg p-1 "
                              onClick={() => state.remove(option)}
                            />
                          </div>
                        );
                      }}
                    </Match>
                  </Switch>
                );
              }}
            </For>
            <Combobox.Input
              disabled={disabled()}
              ref={setInputRef}
              class="flex-1 min-h-7 p-1 min-w-[200px] outline-none placeholder:text-ink-placeholder"
              classList={{
                'ml-1': selectedLen() === 0,
              }}
              onKeyDown={(e) => {
                if (
                  (e.key === 'a' && e.ctrlKey) ||
                  (e.key === 'a' && e.metaKey)
                ) {
                  setDisabled(true);
                  queueMicrotask(() => setDisabled(false));
                }
              }}
            />
          </div>
        )}
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content class="z-modal-content bg-menu border translate-y-1 border-edge p-1">
          <Combobox.Listbox
            class="flex flex-col gap-1"
            scrollToItem={scrollToItem()}
          >
            {(items) => {
              const arr = Array.from(items());
              const count = arr.length;
              const height = clamp(count, 0, 6) * 36;

              const [handle, setHandle] =
                createSignal<VirtualizerHandle | null>(null);

              setScrollToItem(() => (key: string) => {
                const _handle = handle();
                if (_handle) {
                  const ndx = arr.findIndex((item) => item.key === key);
                  if (ndx > -1) {
                    _handle.scrollToIndex(ndx, { align: 'nearest' });
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
      </Combobox.Portal>
      <Combobox.ErrorMessage class="text-xs text-failure mt-1">
        *At least one participant is required
      </Combobox.ErrorMessage>
    </Combobox>
  );
}
