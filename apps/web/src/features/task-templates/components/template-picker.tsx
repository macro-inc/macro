import { t } from '@app/lib/i18n';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import {
  Button,
  cn,
  Dialog,
  Dropdown,
  Input,
  type ManagedDialogProps,
  SingleSelectCheck,
} from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';

/** A template row supplies actions without exposing transport or query state. */
export type TemplatePickerItem = {
  key: string;
  label: string;
  shared: boolean;
  select(): void;
  edit?: () => void;
  remove?: () => void;
};

type TemplateChoicesProps = {
  items: readonly TemplatePickerItem[];
  loading: boolean;
  error: boolean;
  selectedKey: string;
  selectedLabel: string;
  onSelectNone(): void;
  onNew(): void;
  onRetry(): void;
};

function TemplateAction(props: {
  menu: boolean;
  label?: string;
  iconOnly?: boolean;
  danger?: boolean;
  closeOnSelect?: boolean;
  value?: string;
  selected?: boolean;
  children: JSX.Element;
  onSelect(): void;
}) {
  return (
    <Switch
      fallback={
        <Button
          variant={props.danger ? 'danger-ghost' : 'ghost'}
          size={props.iconOnly ? 'icon-xs' : 'sm'}
          fullWidth={!props.iconOnly}
          class={props.iconOnly ? 'shrink-0' : 'min-w-0 justify-start'}
          aria-label={props.label}
          aria-pressed={props.value ? props.selected : undefined}
          onClick={props.onSelect}
        >
          {props.children}
        </Button>
      }
    >
      <Match when={props.menu && props.value}>
        <Dropdown.RadioItem
          value={props.value ?? ''}
          class="min-w-0 flex-1"
          aria-label={props.label}
          textValue={props.label}
          onSelect={props.onSelect}
        >
          {props.children}
        </Dropdown.RadioItem>
      </Match>
      <Match when={props.menu}>
        <Dropdown.Item
          class={cn(
            props.iconOnly ? 'w-7 shrink-0 justify-center' : 'min-w-0 flex-1',
            props.danger && 'text-failure-ink'
          )}
          aria-label={props.label}
          textValue={props.label}
          onSelect={props.onSelect}
          closeOnSelect={props.closeOnSelect}
        >
          {props.children}
        </Dropdown.Item>
      </Match>
    </Switch>
  );
}

function TemplateChoices(
  props: TemplateChoicesProps & { menu: boolean; onClose(): void }
) {
  const [search, setSearch] = createSignal('');
  let searchInput: HTMLInputElement | undefined;
  let choices: HTMLDivElement | undefined;
  const filtered = () => {
    const query = search().trim().toLocaleLowerCase();
    return props.items.filter((item) =>
      item.label.toLocaleLowerCase().includes(query)
    );
  };
  const run = (action: () => void) => {
    props.onClose();
    action();
  };
  return (
    <div class="flex min-h-0 flex-col">
      <div class="shrink-0 p-1.5">
        <Input
          ref={(element) => {
            searchInput = element;
            if (props.menu)
              queueMicrotask(() => element.isConnected && element.focus());
          }}
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder={t('create.taskTemplateSearch')}
          aria-label={t('create.taskTemplateSearch')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') return;
            event.stopPropagation();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              choices
                ?.querySelector<HTMLElement>(
                  '[role="menuitem"], [role="menuitemradio"], button'
                )
                ?.focus();
            }
          }}
        />
      </div>
      <div
        ref={choices}
        class="flex max-h-80 min-h-0 flex-col overflow-y-auto overscroll-contain p-1.5 pt-0"
        onKeyDown={(event) => {
          if (props.menu && event.key === 'ArrowUp') {
            const first = choices?.querySelector(
              '[role="menuitem"], [role="menuitemradio"]'
            );
            if (first === event.target) {
              event.preventDefault();
              event.stopPropagation();
              searchInput?.focus();
            }
          }
        }}
      >
        <TemplateAction
          menu={props.menu}
          value="none"
          selected={props.selectedKey === 'none'}
          onSelect={() => run(props.onSelectNone)}
        >
          <ProhibitIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1">{t('create.taskTemplateNone')}</span>
          <SingleSelectCheck active={props.selectedKey === 'none'} />
        </TemplateAction>
        <TemplateAction
          menu={props.menu}
          value="new"
          selected={props.selectedKey === 'new'}
          onSelect={() => run(props.onNew)}
        >
          <PlusIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1">{t('create.taskTemplateNew')}</span>
          <SingleSelectCheck active={props.selectedKey === 'new'} />
        </TemplateAction>
        <hr class="my-1 border-edge-muted" />
        <Switch>
          <Match when={props.error}>
            <div class="flex flex-col items-start gap-2 px-2 py-3 text-sm">
              <p role="alert" class="text-failure-ink">
                {t('create.taskTemplateLoadError')}
              </p>
              <TemplateAction
                menu={props.menu}
                closeOnSelect={false}
                onSelect={props.onRetry}
              >
                {t('create.taskTemplateRetry')}
              </TemplateAction>
            </div>
          </Match>
          <Match when={props.loading && props.items.length === 0}>
            <div
              role="status"
              class="flex items-center gap-2 px-2 py-4 text-sm text-ink-muted"
            >
              <LoadingSpinner class="size-5 p-0" />
              {t('common.loading')}
            </div>
          </Match>
          <Match when={filtered().length === 0}>
            <div
              role="status"
              class="flex flex-col items-center gap-2 px-5 py-6 text-center"
            >
              <CopyIcon class="size-6 text-ink-muted" />
              <p class="text-sm font-medium">
                {props.items.length === 0
                  ? t('create.taskTemplateEmpty')
                  : t('create.taskTemplateNoMatches')}
              </p>
              <p class="text-xs text-ink-muted">
                {props.items.length === 0
                  ? t('create.taskTemplateEmptyDescription')
                  : t('create.taskTemplateNoMatchesDescription')}
              </p>
            </div>
          </Match>
        </Switch>
        <For each={filtered()}>
          {(item) => (
            <div class="flex min-w-0 items-center gap-1">
              <TemplateAction
                menu={props.menu}
                value={item.key}
                selected={props.selectedKey === item.key}
                label={item.label}
                onSelect={() => run(item.select)}
              >
                <CopyIcon class="size-4 shrink-0" />
                <span class="min-w-0 truncate">{item.label}</span>
                <span class="ml-auto shrink-0 text-xs text-ink-muted">
                  {item.shared
                    ? t('create.taskTemplateTeam')
                    : t('create.taskTemplatePersonal')}
                </span>
                <SingleSelectCheck active={props.selectedKey === item.key} />
              </TemplateAction>
              <Show when={item.edit}>
                {(edit) => (
                  <TemplateAction
                    menu={props.menu}
                    iconOnly
                    label={t('create.taskTemplateEditNamed', {
                      name: item.label,
                    })}
                    onSelect={() => run(edit())}
                  >
                    <PencilIcon class="size-4" />
                  </TemplateAction>
                )}
              </Show>
              <Show when={item.remove}>
                {(remove) => (
                  <TemplateAction
                    menu={props.menu}
                    iconOnly
                    danger
                    label={t('create.taskTemplateDeleteNamed', {
                      name: item.label,
                    })}
                    onSelect={() => run(remove())}
                  >
                    <TrashIcon class="size-4" />
                  </TemplateAction>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** Anchored desktop picker; the trigger keeps the shared Button styling. */
export function TemplateDropdown(
  props: ManagedDialogProps & TemplateChoicesProps & { disabled: boolean }
) {
  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
    >
      <Dropdown.Trigger
        variant="secondary"
        size="sm"
        disabled={props.disabled}
        class="max-w-full min-w-0"
        tooltip={t('create.taskTemplateSelected', {
          name: props.selectedLabel,
        })}
      >
        <CopyIcon class="size-4 shrink-0" />
        <span class="min-w-0 max-w-50 truncate">{props.selectedLabel}</span>
        <CaretDownIcon class="size-3 shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0"
        aria-label={t('create.taskTemplatePickerTitle')}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Dropdown.RadioGroup value={props.selectedKey}>
          <TemplateChoices
            {...props}
            menu
            onClose={() => props.onOpenChange(false)}
          />
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** The shared Dialog supplies the touch picker sheet. */
export function TemplatePicker(
  props: ManagedDialogProps & TemplateChoicesProps
) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-120 max-w-[calc(100vw-2rem)]"
    >
      <div class="flex min-h-0 flex-col gap-3 p-3">
        <div class="flex flex-col gap-1 px-2 pt-2">
          <Dialog.Title class="text-base font-medium">
            {t('create.taskTemplatePickerTitle')}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-ink-muted">
            {t('create.taskTemplatePickerDescription')}
          </Dialog.Description>
        </div>
        <TemplateChoices
          {...props}
          menu={false}
          onClose={() => props.onOpenChange(false)}
        />
      </div>
    </Dialog>
  );
}
