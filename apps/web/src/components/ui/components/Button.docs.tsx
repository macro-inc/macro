import { defineDoc } from '@app/features/ui-gallery/types';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { macroDarkTheme } from '@theme/themes/macro-dark';
import { macroLightTheme } from '@theme/themes/macro-light';
import { themeCssVars } from '@theme/utils/themeCssVars';
import { createSignal, For } from 'solid-js';
import { Button, type ButtonVariant } from './Button';
import { ButtonGroup } from './ButtonGroup';

const VARIANTS: ButtonVariant[] = [
  'primary',
  'accent',
  'secondary',
  'outline',
  'ghost',
  'danger',
  'success',
  'link',
];

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="flex flex-col gap-4">
      <For each={VARIANTS}>
        {(variant) => (
          <div class="flex flex-wrap items-center gap-4">
            <span class="w-20 font-mono text-xs text-ink-muted">{variant}</span>
            <Button variant={variant}>Button</Button>
            <Button variant={variant}>
              <PlusIcon class="size-4" aria-hidden="true" />
              Create item
            </Button>
            <Button variant={variant}>
              Continue
              <ArrowRightIcon class="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <For each={['xs', 'sm', 'md', 'lg', 'xl'] as const}>
          {(size) => (
            <Button variant="secondary" size={size}>
              {size}
            </Button>
          )}
        </For>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <For
          each={
            ['icon-xs', 'icon-sm', 'icon-md', 'icon-lg', 'icon-xl'] as const
          }
        >
          {(size) => (
            <Button
              variant="secondary"
              size={size}
              aria-label={`Add item (${size})`}
              tooltip={size}
            >
              <PlusIcon class="size-4" />
            </Button>
          )}
        </For>
      </div>
    </div>
  );
}
// #endregion

// #region demo:states
function StatesDemo() {
  const [pressed, setPressed] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  return (
    <div class="flex flex-wrap items-center gap-4">
      <Button
        variant="ghost"
        aria-pressed={pressed()}
        onClick={() => setPressed(!pressed())}
      >
        Toggle {pressed() ? 'on' : 'off'}
      </Button>
      <Button variant="secondary" disabled>
        Disabled
      </Button>
      <Button
        variant="primary"
        loading={loading()}
        onClick={() => setLoading(true)}
      >
        Save example
      </Button>
      <Button
        variant="ghost"
        disabled={!loading()}
        onClick={() => setLoading(false)}
      >
        Reset loading
      </Button>
      <Button
        size="icon-md"
        variant="secondary"
        aria-label="Add item"
        tooltip={{ content: 'Add item', shortcut: 'meta+enter' }}
      >
        <PlusIcon class="size-4" />
      </Button>
    </div>
  );
}
// #endregion

// #region demo:group
function GroupDemo() {
  return (
    <ButtonGroup
      finish="raised"
      variant="secondary"
      size="md"
      aria-label="Document actions"
    >
      <ButtonGroup.Button>Add</ButtonGroup.Button>
      <ButtonGroup.Divider />
      <ButtonGroup.Button>Duplicate</ButtonGroup.Button>
      <ButtonGroup.Divider />
      <ButtonGroup.Button>Archive</ButtonGroup.Button>
    </ButtonGroup>
  );
}
// #endregion

// #region demo:header
function HeaderDemo() {
  const [actions, setActions] = createSignal(0);
  return (
    <div class="@container/split-header flex w-full items-center justify-between gap-4">
      <span class="text-sm text-ink-muted" aria-live="polite">
        Local actions: {actions()}
      </span>
      <HeaderActionButton
        label="Add item"
        icon={
          <PlusIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
        }
        tooltip="Add a local example item"
        onClick={() => setActions(actions() + 1)}
      />
    </div>
  );
}
// #endregion

// #region demo:trigger
function TriggerDemo() {
  const [choice, setChoice] = createSignal('No action selected');
  return (
    <div class="flex items-center gap-4">
      <DropdownMenu>
        <DropdownMenu.Trigger as={Button} variant="secondary">
          Actions
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="menu-surface z-50 min-w-40 p-1">
            <DropdownMenu.Item
              class="rounded-md px-3 py-2 outline-none data-highlighted:bg-hover"
              onSelect={() => setChoice('Duplicate selected')}
            >
              Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="rounded-md px-3 py-2 outline-none data-highlighted:bg-hover"
              onSelect={() => setChoice('Archive selected')}
            >
              Archive
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <span class="text-sm text-ink-muted" aria-live="polite">
        {choice()}
      </span>
    </div>
  );
}
// #endregion

// #region demo:themes
function ThemesDemo() {
  return (
    <div class="flex flex-col gap-4">
      <For each={[macroLightTheme, macroDarkTheme]}>
        {(theme) => (
          <div
            data-theme-light={String(theme.mode === 'light')}
            style={themeCssVars(theme)}
            class="rounded-xl bg-panel p-4 text-ink"
          >
            <p class="mb-4 text-sm">{theme.name}</p>
            <VariantsDemo />
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:finishes
function FinishesDemo() {
  return (
    <div class="flex flex-wrap items-center gap-4">
      <Button variant="secondary">Automatic</Button>
      <Button variant="secondary" finish="flat">
        Flat
      </Button>
      <Button variant="ghost" finish="raised">
        Framed ghost
      </Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="secondary" aria-pressed="true">
        Pressed
      </Button>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Button',
  category: 'Actions',
  description:
    'Shared action control with solid neutral primary, explicit accent emphasis, automatic desktop elevation and touch glass, explicit icon sizes, and configurable tooltips.',
  status: 'beta',
  exports: ['Button', 'ButtonGroup'],
  import: "import { Button, ButtonGroup } from '@ui';",
  demos: [
    { id: 'variants', title: 'Variants', render: VariantsDemo },
    { id: 'sizes', title: 'Text and icon sizes', render: SizesDemo },
    { id: 'states', title: 'State and tooltip behavior', render: StatesDemo },
    { id: 'group', title: 'Grouped actions', render: GroupDemo },
    { id: 'header', title: 'Header action', render: HeaderDemo, fill: true },
    { id: 'trigger', title: 'Headless menu trigger', render: TriggerDemo },
    { id: 'themes', title: 'Light and dark', render: ThemesDemo, fill: true },
    {
      id: 'finishes',
      title: 'Automatic and flat finishes',
      render: FinishesDemo,
    },
  ],
});
