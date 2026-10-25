import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { ModelEffortMenu } from '@core/component/AI/component/input/ModelEffortMenu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import Check from '@phosphor/check.svg';
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
  // The desktop slider stages its choice here and commits it when the menu closes.
  const [pending, setPending] = createSignal<EffortChoice>();
  let content: HTMLElement | undefined;
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) {
      const choice = pending();
      setPending(undefined);
      if (
        choice &&
        choice.configId === props.config?.id &&
        choices().some((option) => option.value === choice.value) &&
        choice.value !== committed() &&
        !props.disabled
      )
        props.onChange(choice);
    }
    props.onOpenChange?.(value);
  };
  const choices = () => props.config?.options ?? [];
  const committed = () => props.value ?? props.config?.currentValue;
  const value = () => pending()?.value ?? committed();
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
            <Dropdown.Content
              ref={content}
              onOpenAutoFocus={(event) => {
                // This menu contains a slider rather than roving menu items.
                event.preventDefault();
                content?.querySelector<HTMLElement>('[role="slider"]')?.focus();
              }}
              class="w-64 rounded-2xl"
              aria-label="Reasoning effort"
              onCloseAutoFocus={props.onCloseAutoFocus}
            >
              <ModelEffortMenu
                effortOnly
                label="Reasoning effort"
                config={props.config}
                value={value()}
                disabled={props.disabled}
                onChange={(next) => {
                  const choice = choices().find(
                    (choice) => choice.value === next
                  );
                  if (props.config && choice)
                    setPending({
                      configId: props.config.id,
                      value: choice.value,
                      name: choice.name,
                    });
                }}
              />
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
