import ChevronDownIcon from '@phosphor/caret-down.svg';
import IconComment from '@phosphor/chat-teardrop.svg';
import CheckIcon from '@phosphor/check.svg';
import IconEye from '@phosphor/eye.svg';
import IconEdit from '@phosphor/pencil.svg';
import IconX from '@phosphor/x.svg';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { Dropdown } from '@ui';
import {
  createContext,
  createMemo,
  createSignal,
  For,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** Optional legacy capabilities supplied at the block adapter boundary. */
export const SharePermissionOptionsContext = createContext<{
  editEnabled: boolean;
  commentEnabled: boolean;
}>();

export const accessLevelText = (
  level?: AccessLevel | null,
  comments = true
) => {
  switch (level) {
    case 'comment':
      return comments ? 'Comment' : 'View';
    case 'view':
      return 'View';
    case 'edit':
      return 'Edit';
    case 'owner':
      return 'Owner';
    default:
      return 'Remove Access';
  }
};

const PERMISSION_ICONS = {
  comment: IconComment,
  view: IconEye,
  edit: IconEdit,
} as const;

export function ShareOptions(props: {
  editPermissionEnabled?: boolean;
  setPermissions: (accessLevel: AccessLevel | null) => void;
  permissions?: AccessLevel | null;
  hideNoAccess?: boolean;
  label?: string | '';
  disabled?: boolean;
  noBorder?: boolean;
  allowedAccessLevels?: readonly AccessLevel[];
}) {
  const policy = useContext(SharePermissionOptionsContext);
  const permissionLabel = (level?: AccessLevel | null) =>
    accessLevelText(level, policy?.commentEnabled);

  const options = createMemo(() => {
    const optionsList: { value: string; label: string }[] = [];

    // Always add view option
    optionsList.push({ value: 'view', label: permissionLabel('view') });

    // Add comment option if applicable
    if (policy?.commentEnabled !== false) {
      optionsList.push({ value: 'comment', label: permissionLabel('comment') });
    }

    // Add edit option if enabled
    if ((props.editPermissionEnabled ?? policy?.editEnabled) !== false) {
      optionsList.push({ value: 'edit', label: permissionLabel('edit') });
    }

    // Add no access option if not hidden
    if (!props.hideNoAccess) {
      optionsList.push({ value: 'none', label: permissionLabel(null) });
    }

    return optionsList.filter(
      (option) =>
        option.value === 'none' ||
        !props.allowedAccessLevels ||
        props.allowedAccessLevels.includes(option.value as AccessLevel)
    );
  });

  const currentValue = createMemo(() => {
    if (props.permissions === null) return 'none';
    return props.permissions || 'none';
  });

  const currentValueText = createMemo(() => {
    const value = currentValue();
    if (value === 'none') return permissionLabel(null);
    return permissionLabel(value as AccessLevel);
  });

  const CurrentIcon = createMemo(() => {
    const value = currentValue();
    if (value === 'none') return IconX;
    return PERMISSION_ICONS[value as keyof typeof PERMISSION_ICONS];
  });

  const [isOpen, setIsOpen] = createSignal(false);

  const handleChange = (value: string) => {
    setIsOpen(false);
    if (value === 'none') {
      props.setPermissions(null);
    } else {
      props.setPermissions(value as AccessLevel);
    }
  };

  return (
    <Dropdown modal={false} open={isOpen()} onOpenChange={setIsOpen}>
      <Dropdown.Trigger
        variant="outline"
        disabled={props.disabled}
        aria-label={props.label}
        class={`min-w-16.75 py-1 pl-2 pr-1 rounded-md flex items-center gap-1 ${props.noBorder ? 'border-0 sm:border' : ''}`}
        on:keydown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
      >
        <Dynamic component={CurrentIcon()} class="size-4 shrink-0" />
        {currentValueText()}
        <ChevronDownIcon class="size-4 text-ink-extra-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
        <Dropdown.RadioGroup
          aria-label={props.label}
          value={currentValue()}
          onChange={handleChange}
        >
          <Dropdown.Group>
            <For each={options().filter((o) => o.value !== 'none')}>
              {(option) => {
                const Icon =
                  PERMISSION_ICONS[
                    option.value as keyof typeof PERMISSION_ICONS
                  ];
                return (
                  <Dropdown.RadioItem value={option.value}>
                    <div class="size-4 shrink-0">
                      {Icon && <Icon class="size-full" />}
                    </div>
                    <span class="flex-1 truncate">{option.label}</span>
                    <Dropdown.ItemIndicator>
                      <CheckIcon class="size-3.5 text-accent" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                );
              }}
            </For>
          </Dropdown.Group>
          <Show when={!props.hideNoAccess}>
            <Dropdown.Group>
              <Dropdown.RadioItem value="none">
                <div class="size-4 shrink-0">
                  <IconX class="size-full" />
                </div>
                <span class="flex-1 truncate">{permissionLabel(null)}</span>
                <Dropdown.ItemIndicator>
                  <CheckIcon class="size-3.5 text-accent" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            </Dropdown.Group>
          </Show>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
