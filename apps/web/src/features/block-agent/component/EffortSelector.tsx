import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import Check from '@icon/system/regular/check.svg';
import { Button, Dropdown, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../state/session-config';

/** Effort control beside the selected model in the composer. */
export function EffortSelector(props: {
  config?: SelectSessionConfigOption;
  value?: string;
  disabled?: boolean;
  onChange: (choice: EffortChoice) => void;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    props.onOpenChange?.(value);
  };
  const choices = () => props.config?.options ?? [];
  const value = () => props.value ?? props.config?.currentValue;
  const index = () =>
    Math.max(
      0,
      choices().findIndex((choice) => choice.value === value())
    );
  const label = () => choices()[index()]?.name ?? 'Default';
  const angle = () => {
    return -70 + (index() / Math.max(1, choices().length - 1)) * 140;
  };
  const contents = () => (
    <svg viewBox="0 0 24 24" class="size-[22px]" fill="none" aria-hidden="true">
      <path
        d="M4.5 18a9 9 0 1 1 15 0"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        opacity="0.45"
      />
      <g transform={`rotate(${angle()} 12 14)`}>
        <path
          d="M12 14V8"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </g>
      <circle cx="12" cy="14" r="2" fill="currentColor" />
    </svg>
  );
  const choose = (choice: SelectSessionConfigOption['options'][number]) => {
    if (!props.config || props.disabled) return;
    props.onChange({
      configId: props.config.id,
      value: choice.value,
      name: choice.name,
    });
    changeOpen(false);
  };
  const optionLabel = (
    choice: SelectSessionConfigOption['options'][number]
  ) => (
    <>
      <span class="flex-1">{choice.name}</span>
      <Show when={choice.value === value()}>
        <Check class="size-4" />
      </Show>
    </>
  );
  return (
    <Show when={choices().length > 1}>
      <Show
        when={isTouchDevice()}
        fallback={
          <Dropdown open={open()} onOpenChange={changeOpen} placement="bottom">
            <Tooltip label={`Effort: ${label()}`} disabled={open()}>
              <Dropdown.Trigger
                variant="ghost"
                size="sm"
                class="size-8 rounded-full p-0"
                disabled={props.disabled}
                aria-label={`Effort: ${label()}`}
              >
                {contents()}
              </Dropdown.Trigger>
            </Tooltip>
            <Dropdown.Content class="w-48" aria-label="Reasoning effort">
              <Dropdown.Group>
                <For each={choices()}>
                  {(choice) => (
                    <Dropdown.Item
                      disabled={props.disabled}
                      onSelect={() => choose(choice)}
                    >
                      {optionLabel(choice)}
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
          onOpenChange={changeOpen}
          restoreFocus={!!props.onCloseAutoFocus}
          onFinalFocus={props.onCloseAutoFocus}
        >
          <MobileDrawer.Trigger
            as={Button}
            variant="ghost"
            size="sm"
            class="size-[34px] rounded-full p-0"
            disabled={props.disabled}
            aria-label={`Effort: ${label()}`}
            title={`Effort: ${label()}`}
            onPointerDown={(event: PointerEvent) => event.preventDefault()}
            onMouseDown={(event: MouseEvent) => event.preventDefault()}
          >
            {contents()}
          </MobileDrawer.Trigger>
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label="Reasoning effort">
              <MobileDrawer.Handle />
              <MobileDrawer.Title class="px-4 pb-3 font-medium">
                Reasoning effort
              </MobileDrawer.Title>
              <MobileDrawer.ScrollBody>
                <MobileDrawer.Section
                  role="group"
                  aria-label="Reasoning effort"
                >
                  <For each={choices()}>
                    {(choice) => (
                      <MobileDrawer.Item
                        aria-pressed={choice.value === value()}
                        disabled={props.disabled}
                        onClick={() => choose(choice)}
                      >
                        {optionLabel(choice)}
                      </MobileDrawer.Item>
                    )}
                  </For>
                </MobileDrawer.Section>
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </Show>
  );
}
