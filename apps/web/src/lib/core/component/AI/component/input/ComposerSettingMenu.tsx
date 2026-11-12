import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import Check from '@icon/system/regular/check.svg';
import { Button, cn, Dropdown, Tooltip } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';

export type ComposerSettingChoice = {
  value: string;
  name: string;
  description?: string | null;
};

/**
 * One named model setting beside a composer's model picker, such as reasoning
 * effort or priority tier. Desktop shows the icon with the current value and
 * opens a menu; touch shows the icon alone and opens a bottom sheet.
 * Renders nothing unless there is more than one choice.
 */
export function ComposerSettingMenu(props: {
  /** The setting's name, used for the menu title and accessible labels. */
  title: string;
  /** The trigger's accessible label, naming the setting and its value. */
  triggerLabel: string;
  icon: JSX.Element;
  choices: readonly ComposerSettingChoice[];
  value?: string;
  /** Highlights the trigger, e.g. for a tier that costs more than standard. */
  active?: boolean;
  disabled?: boolean;
  onSelect: (choice: ComposerSettingChoice) => void;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    props.onOpenChange?.(value);
  };
  const current = () =>
    props.choices.find((choice) => choice.value === props.value) ??
    props.choices[0];
  const choose = (choice: ComposerSettingChoice) => {
    if (props.disabled) return;
    props.onSelect(choice);
    changeOpen(false);
  };
  const row = (choice: ComposerSettingChoice) => (
    <>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate">{choice.name}</span>
        <Show when={choice.description}>
          <span class="text-xs text-ink-muted">{choice.description}</span>
        </Show>
      </span>
      <Show when={choice.value === current()?.value}>
        <Check class="size-4 shrink-0" />
      </Show>
    </>
  );
  const tone = () =>
    props.active ? 'text-accent bg-accent/10' : 'text-ink-muted';

  return (
    <Show when={props.choices.length > 1}>
      <Show
        when={isTouchDevice()}
        fallback={
          <Dropdown open={open()} onOpenChange={changeOpen} placement="bottom">
            <Tooltip label={props.title} disabled={open()}>
              <Dropdown.Trigger
                variant="ghost"
                size="sm"
                class={cn(
                  'h-8 shrink-0 gap-1 rounded-full px-2 text-xs',
                  tone()
                )}
                disabled={props.disabled}
                aria-label={props.triggerLabel}
              >
                {props.icon}
                <span class="whitespace-nowrap">{current()?.name}</span>
              </Dropdown.Trigger>
            </Tooltip>
            <Dropdown.Content
              class="min-w-56 max-w-80"
              aria-label={props.title}
              onCloseAutoFocus={props.onCloseAutoFocus}
            >
              <Dropdown.Group>
                <Dropdown.GroupLabel>{props.title}</Dropdown.GroupLabel>
                <For each={props.choices}>
                  {(choice) => (
                    <Dropdown.Item
                      disabled={props.disabled}
                      onSelect={() => choose(choice)}
                    >
                      {row(choice)}
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
            class={cn('size-[34px] rounded-full p-0', tone())}
            disabled={props.disabled}
            aria-label={props.triggerLabel}
            title={props.triggerLabel}
            onPointerDown={(event: PointerEvent) => event.preventDefault()}
            onMouseDown={(event: MouseEvent) => event.preventDefault()}
          >
            {props.icon}
          </MobileDrawer.Trigger>
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label={props.title}>
              <MobileDrawer.Handle />
              <MobileDrawer.Title class="px-4 pb-3 font-medium">
                {props.title}
              </MobileDrawer.Title>
              <MobileDrawer.ScrollBody>
                <MobileDrawer.Section role="group" aria-label={props.title}>
                  <For each={props.choices}>
                    {(choice) => (
                      <MobileDrawer.Item
                        aria-pressed={choice.value === current()?.value}
                        disabled={props.disabled}
                        onClick={() => choose(choice)}
                      >
                        {row(choice)}
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
