import { isInBlock, useBlockName } from '@core/block';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { blockEditPermissionEnabledSignal } from '@core/signal/load';
import ChevronDownIcon from '@icon/system/regular/caret-down.svg';
import IconComment from '@icon/system/regular/chat-teardrop.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import IconEye from '@icon/system/regular/eye.svg';
import IconEdit from '@icon/system/regular/pencil.svg';
import IconX from '@icon/system/regular/x.svg';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { Dropdown } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const accessLevelText = (accessLevel?: AccessLevel | null) => {
  const blockName = isInBlock() ? useBlockName() : undefined;
  switch (accessLevel) {
    case 'comment':
      if (blockName === 'md' && !ENABLE_MARKDOWN_COMMENTS) {
        return 'View';
      }
      return 'Comment';
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
  /** Grants this recipient can hold; removal stays governed by `hideNoAccess`. */
  allowedAccessLevels?: readonly AccessLevel[];
}) {
  const blockEditPermissionEnabled = isInBlock()
    ? blockEditPermissionEnabledSignal
    : () => true;
  const editPermissionEnabled = () =>
    props.editPermissionEnabled ?? blockEditPermissionEnabled();
  const blockName = isInBlock() ? useBlockName() : undefined;

  const options = createMemo(() => {
    const optionsList: { value: string; label: string }[] = [];

    // Always add view option
    optionsList.push({
      value: 'view',
      label: `Can ${accessLevelText('view').toLowerCase()}`,
    });

    // Add comment option if applicable
    if (blockName !== 'md' || ENABLE_MARKDOWN_COMMENTS) {
      optionsList.push({
        value: 'comment',
        label: `Can ${accessLevelText('comment').toLowerCase()}`,
      });
    }

    // Add edit option if enabled
    if (editPermissionEnabled()) {
      optionsList.push({
        value: 'edit',
        label: `Can ${accessLevelText('edit').toLowerCase()}`,
      });
    }

    // Add no access option if not hidden
    if (!props.hideNoAccess) {
      optionsList.push({ value: 'none', label: accessLevelText(null) });
    }

    const allowed = props.allowedAccessLevels;
    return allowed
      ? optionsList.filter(
          (option) =>
            option.value === 'none' ||
            allowed.includes(option.value as AccessLevel)
        )
      : optionsList;
  });

  const currentValue = createMemo(() => {
    if (props.permissions === null) return 'none';
    return props.permissions || 'none';
  });

  const currentValueText = createMemo(() => {
    const value = currentValue();
    if (value === 'none') return accessLevelText(null);
    return (
      options().find((option) => option.value === value)?.label ??
      accessLevelText(value as AccessLevel)
    );
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
        variant="secondary"
        disabled={props.disabled}
        class={`min-w-16.75 py-1 pl-2 pr-1 flex items-center gap-1 ${props.noBorder ? 'border-0 sm:border' : ''}`}
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
        <Dropdown.RadioGroup value={currentValue()} onChange={handleChange}>
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
                <span class="flex-1 truncate">{accessLevelText(null)}</span>
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
