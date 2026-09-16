import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  MODEL_PROVIDER_ICON,
  Model,
} from '@core/component/AI/constant';
import type { TModel } from '@core/component/AI/types';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import CheckIcon from '@phosphor/check.svg';
import CloseIcon from '@phosphor/x.svg';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import LockIcon from '@phosphor-icons/core/regular/lock-simple.svg?component-solid';
import { Button, cn, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** A model and whether the current user may select it. */
export type ModelOption = { id: TModel; available: boolean };

type ModelSelectorProps = {
  selectedModel?: TModel;
  /** Per-model availability. Defaults to all models available. */
  models?: ModelOption[];
  onSelect: (model: TModel) => void;
  /** Called when an unavailable model is clicked (e.g. to open the paywall). */
  onLocked?: (model: TModel) => void;
  /** Collapse the trigger to just the provider icon (narrow inputs). */
  compact?: boolean;
};

const ALL_AVAILABLE: ModelOption[] = (Object.values(Model) as TModel[]).map(
  (id) => ({ id, available: true })
);

const MODEL_DESCRIPTION: Record<TModel, string> = {
  [Model.sonnet5]: 'Everyday writing, coding, and questions',
  [Model.opus5]: 'Complex tasks and deeper analysis',
  [Model.haiku45]: 'Quick answers and lighter tasks',
  [Model.gpt56]: 'Reasoning, writing, and problem solving',
  [Model.gpt56Mini]: 'Fast help with everyday tasks',
};

export function ModelSelector(props: ModelSelectorProps) {
  const [open, setOpen] = createSignal(false);
  const model = () => props.selectedModel ?? DEFAULT_MODEL;
  const options = () =>
    props.models && props.models.length > 0 ? props.models : ALL_AVAILABLE;

  const handleSelect = (option: ModelOption) => {
    if (option.available) {
      props.onSelect(option.id);
    } else {
      props.onLocked?.(option.id);
    }
  };

  return (
    <Show
      when={isMobile()}
      fallback={
        <Dropdown placement="top-end">
          <Dropdown.Trigger
            variant="ghost"
            size={props.compact ? 'icon-sm' : 'sm'}
            class={cn(
              'rounded-lg text-sm text-ink-subtle',
              !props.compact && 'gap-1.5'
            )}
            label={props.compact ? MODEL_PRETTYNAME[model()] : undefined}
          >
            <Dynamic component={MODEL_PROVIDER_ICON[model()]} />
            <Show when={!props.compact}>
              {MODEL_PRETTYNAME[model()]}
              <CaretDown />
            </Show>
          </Dropdown.Trigger>
          <Dropdown.Content class="w-60 max-w-[calc(100vw-1rem)]">
            <Dropdown.Group>
              <For each={options()}>
                {(option) => (
                  // Unavailable items stay clickable (not Kobalte-disabled) so the
                  // click can open the paywall; they're just visually dimmed.
                  <Dropdown.Item
                    class={cn('gap-2', !option.available && 'opacity-50')}
                    onSelect={() => handleSelect(option)}
                  >
                    <Dynamic
                      component={MODEL_PROVIDER_ICON[option.id]}
                      class="size-4 shrink-0"
                    />
                    <span class="flex-1 truncate">
                      {MODEL_PRETTYNAME[option.id]}
                    </span>
                    <Show when={!option.available}>
                      <LockIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
                    </Show>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      }
    >
      <MobileDrawer
        side="bottom"
        open={open()}
        onOpenChange={setOpen}
        preventScroll={false}
        preventScrollbarShift={false}
      >
        {/* Keep the drawer mounted when opening it dismisses the keyboard. */}
        <MobileDrawer.Trigger
          as={Button}
          variant="ghost"
          size="icon-sm"
          // Prevent compatibility mouse focus from hiding the trigger before
          // click. Leave pointerdown uncancelled so WebKit emits the tap click.
          onMouseDown={(event) => {
            if (event.button === 0) event.preventDefault();
          }}
          aria-label={`Choose model, ${MODEL_PRETTYNAME[model()]}`}
          class={cn(
            'touch:min-h-11 touch:min-w-11 rounded-full text-sm text-ink-subtle',
            !virtualKeyboardVisible() && 'hidden'
          )}
        >
          <Dynamic component={MODEL_PROVIDER_ICON[model()]} />
        </MobileDrawer.Trigger>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content
            aria-label="Select model"
            class="overflow-hidden"
          >
            <MobileDrawer.Handle class="pb-1" />
            <div class="flex shrink-0 items-center justify-between gap-3 px-6 pb-4">
              <h2 class="text-lg font-semibold text-ink">Select model</h2>
              <MobileDrawer.Close
                as={Button}
                variant="ghost"
                size="icon-sm"
                aria-label="Close model picker"
                class="size-11 shrink-0 rounded-full bg-ink/6"
              >
                <CloseIcon class="size-5" />
              </MobileDrawer.Close>
            </div>
            <MobileDrawer.ScrollBody>
              <MobileDrawer.Section role="group" aria-label="Models">
                <For each={options()}>
                  {(option) => (
                    <MobileDrawer.Item
                      aria-label={`${MODEL_PRETTYNAME[option.id]}${option.available ? '' : ', upgrade required'}`}
                      aria-pressed={model() === option.id}
                      class={cn(
                        'min-h-19 gap-3 px-4 py-4',
                        !option.available && 'opacity-50'
                      )}
                      onClick={() => {
                        if (!option.available) setOpen(false);
                        handleSelect(option);
                      }}
                    >
                      <Dynamic
                        component={MODEL_PROVIDER_ICON[option.id]}
                        class="size-6 shrink-0 text-ink-muted"
                      />
                      <span class="flex min-w-0 flex-1 flex-col gap-1">
                        <span class="text-base font-medium leading-5">
                          {MODEL_PRETTYNAME[option.id]}
                        </span>
                        <span class="text-[13px] leading-[18px] text-ink-muted">
                          {MODEL_DESCRIPTION[option.id]}
                        </span>
                      </span>
                      <span class="flex size-5 shrink-0 items-center justify-center">
                        <Show
                          when={!option.available}
                          fallback={
                            <Show when={model() === option.id}>
                              <CheckIcon class="size-5 text-accent" />
                            </Show>
                          }
                        >
                          <LockIcon class="size-4 text-ink-muted" />
                        </Show>
                      </span>
                    </MobileDrawer.Item>
                  )}
                </For>
              </MobileDrawer.Section>
              <div class="px-6 pt-5 pb-2">
                <MobileDrawer.Close
                  as={Button}
                  variant="cta"
                  size="xl"
                  aria-label="Done"
                  class="w-full rounded-full text-base"
                >
                  Done
                </MobileDrawer.Close>
              </div>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
