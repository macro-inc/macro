import { t } from '@app/lib/i18n';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FileIcon from '@icon/system/regular/file.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { DropdownSearchInput } from '@property/editors/selectors/PropertyOptionSelector';
import {
  Button,
  type ButtonVariant,
  buttonClasses,
  cn,
  Dialog,
  Dropdown,
  type ManagedDialogProps,
} from '@ui';
import {
  createContext,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { TemplatePickerItem } from '../../task-composer/core/template-selection';

type TemplateChoicesProps = {
  items: readonly TemplatePickerItem[];
  loading: boolean;
  error: boolean;
  selectedKey: string;
  selectedLabel: string;
  teamName: string;
  dirty: boolean;
  pending: boolean;
  onReset?: () => void;
  onUpdate?: () => void;
  onSelectNone(): void;
  onNew(): void;
  onRetry(): void;
};

const TemplateSurfaceContext = createContext<{ menu: boolean }>();

function useTemplateSurface() {
  const surface = useContext(TemplateSurfaceContext);
  if (!surface) throw new Error('Template choices require a surface');
  return surface;
}

function TemplateOption(props: {
  value: string;
  selected: boolean;
  label?: string;
  children: JSX.Element;
  onSelect(): void;
}) {
  const surface = useTemplateSurface();
  return (
    <Show
      when={surface.menu}
      fallback={
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          class="min-w-0 justify-start"
          aria-label={props.label}
          aria-pressed={props.selected}
          onClick={props.onSelect}
        >
          {props.children}
        </Button>
      }
    >
      <Dropdown.RadioItem
        value={props.value}
        class="min-w-0 flex-1 group-hover/template:bg-ink/5 group-focus-within/template:bg-ink/5"
        aria-label={props.label}
        textValue={props.label}
        onSelect={props.onSelect}
      >
        {props.children}
      </Dropdown.RadioItem>
    </Show>
  );
}

function TemplateCommand(props: {
  variant?: ButtonVariant;
  disabled?: boolean;
  closeOnSelect?: boolean;
  children: JSX.Element;
  onSelect(): void;
}) {
  const surface = useTemplateSurface();
  const menuClass = () => {
    if (!props.variant) return 'min-w-0 flex-1';
    return buttonClasses({
      variant: props.variant,
      size: 'sm',
      class: 'w-auto data-highlighted:overlay-hover',
    });
  };
  return (
    <Show
      when={surface.menu}
      fallback={
        <Button
          variant={props.variant ?? 'ghost'}
          size="sm"
          fullWidth={!props.variant}
          class={cn(!props.variant && 'min-w-0 justify-start')}
          disabled={props.disabled}
          onClick={props.onSelect}
        >
          {props.children}
        </Button>
      }
    >
      <Dropdown.Item
        class={menuClass()}
        disabled={props.disabled}
        closeOnSelect={props.closeOnSelect}
        onSelect={props.onSelect}
      >
        {props.children}
      </Dropdown.Item>
    </Show>
  );
}

function TemplateEdit(props: { label: string; onSelect(): void }) {
  const surface = useTemplateSurface();
  return (
    <Show
      when={surface.menu}
      fallback={
        <Button
          variant="ghost"
          size="icon-xs"
          class="shrink-0"
          aria-label={props.label}
          onClick={props.onSelect}
        >
          <PencilIcon class="size-4" />
        </Button>
      }
    >
      <Dropdown.Item
        class={buttonClasses({
          variant: 'ghost',
          size: 'icon-xs',
          class: 'data-highlighted:overlay-hover',
        })}
        aria-label={props.label}
        textValue={props.label}
        onSelect={props.onSelect}
      >
        <PencilIcon class="size-4" />
      </Dropdown.Item>
    </Show>
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
    <TemplateSurfaceContext.Provider
      value={{
        get menu() {
          return props.menu;
        },
      }}
    >
      <div class="flex min-h-0 flex-col">
        <div class="shrink-0">
          <DropdownSearchInput
            inputRef={(element) => {
              searchInput = element;
              if (props.menu)
                queueMicrotask(() => element.isConnected && element.focus());
            }}
            value={search()}
            onInput={setSearch}
            placeholder={t('create.taskTemplateSearch')}
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
          class="flex max-h-80 min-h-0 flex-col overflow-y-auto overscroll-contain p-1.5"
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
          <TemplateOption
            value="none"
            selected={props.selectedKey === 'none'}
            onSelect={() => run(props.onSelectNone)}
          >
            <FileIcon class="size-4 shrink-0" />
            <span class="min-w-0 flex-1">{t('create.taskTemplateNone')}</span>
            <Show when={props.selectedKey === 'none'}>
              <CheckIcon class="size-3.5 shrink-0 text-accent" />
            </Show>
          </TemplateOption>
          <Switch>
            <Match when={props.error}>
              <div class="flex flex-col items-start gap-2 px-2 py-3 text-sm">
                <p role="alert" class="text-failure-ink">
                  {t('create.taskTemplateLoadError')}
                </p>
                <TemplateCommand closeOnSelect={false} onSelect={props.onRetry}>
                  {t('create.taskTemplateRetry')}
                </TemplateCommand>
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
              </div>
            </Match>
          </Switch>
          <For each={[false, true]}>
            {(shared) => (
              <Show when={filtered().some((item) => item.shared === shared)}>
                <Dynamic
                  component={props.menu ? Dropdown.Group : 'div'}
                  class="p-0"
                >
                  <Dynamic
                    component={props.menu ? Dropdown.GroupLabel : 'p'}
                    class={
                      props.menu
                        ? undefined
                        : 'px-2 h-7 flex items-center text-xs text-ink-extra-muted'
                    }
                  >
                    {shared ? props.teamName : t('create.taskTemplatePersonal')}
                  </Dynamic>
                  <For
                    each={filtered().filter((item) => item.shared === shared)}
                  >
                    {(item) => (
                      <div class="group/template relative min-w-0">
                        <TemplateOption
                          value={item.key}
                          selected={props.selectedKey === item.key}
                          label={item.label}
                          onSelect={() => run(item.select)}
                        >
                          <div
                            class={cn(
                              'flex min-w-0 flex-1 items-center gap-1.5',
                              item.edit && 'pr-7'
                            )}
                          >
                            <CopyIcon class="size-4 shrink-0" />
                            <span class="min-w-0 flex-1 truncate">
                              {item.label}
                            </span>
                            <Show
                              when={
                                props.dirty && props.selectedKey === item.key
                              }
                            >
                              <span class="size-1.5 shrink-0 rounded-full bg-accent" />
                            </Show>
                            <Show when={props.selectedKey === item.key}>
                              <CheckIcon class="size-3.5 shrink-0 text-accent" />
                            </Show>
                          </div>
                        </TemplateOption>
                        <Show when={item.edit}>
                          {(edit) => (
                            <div class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/template:opacity-100 group-focus-within/template:opacity-100 touch:opacity-100">
                              <TemplateEdit
                                label={t('create.taskTemplateEditNamed', {
                                  name: item.label,
                                })}
                                onSelect={() => run(edit())}
                              />
                            </div>
                          )}
                        </Show>
                      </div>
                    )}
                  </For>
                </Dynamic>
              </Show>
            )}
          </For>
          <Dropdown.Separator class="my-1 border-edge-muted" />
          <TemplateCommand onSelect={() => run(props.onNew)}>
            <PlusIcon class="size-4 shrink-0" />
            <span class="min-w-0 flex-1">{t('create.taskTemplateNew')}</span>
          </TemplateCommand>
          <Show when={props.dirty && props.onReset && props.onUpdate}>
            <Dropdown.Separator class="my-1 border-edge-muted" />
            <div class="flex items-center justify-between gap-2 p-1.5">
              <TemplateCommand
                variant="ghost"
                disabled={props.pending}
                onSelect={() => props.onReset && run(props.onReset)}
              >
                {t('create.taskTemplateReset')}
              </TemplateCommand>
              <TemplateCommand
                variant="primary"
                disabled={props.pending}
                onSelect={() => props.onUpdate && run(props.onUpdate)}
              >
                {t('create.taskTemplateUpdate')}
              </TemplateCommand>
            </div>
          </Show>
        </div>
      </div>
    </TemplateSurfaceContext.Provider>
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
        <Show
          when={props.selectedKey === 'none'}
          fallback={<CopyIcon class="size-4 shrink-0" />}
        >
          <FileIcon class="size-4 shrink-0" />
        </Show>
        <span class="min-w-0 max-w-50 truncate">{props.selectedLabel}</span>
        <Show when={props.dirty}>
          <span class="size-1.5 shrink-0 rounded-full bg-accent" />
        </Show>
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
