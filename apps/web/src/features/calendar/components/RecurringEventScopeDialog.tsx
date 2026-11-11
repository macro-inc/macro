import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import CheckIcon from '@icon/system/regular/check.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel, RadioGroup } from '@ui';
import { For, type JSX, Show } from 'solid-js';

export type RecurringEventScopeOption<Scope extends string> = {
  scope: Scope;
  label: string;
};

export function RecurringEventScopeDialog<Scope extends string>(props: {
  open: boolean;
  title: string;
  options: readonly RecurringEventScopeOption<NoInfer<Scope>>[];
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  mobileConfirmLabel?: string;
  description?: string;
  scopeLabel?: string;
  closeLabel?: string;
  pending?: boolean;
  children?: JSX.Element;
}) {
  const onScopeChange = (value: string) => {
    const option = props.options.find((option) => option.scope === value);
    if (option) props.onScopeChange(option.scope);
  };
  const onConfirm = () => {
    if (!props.pending) props.onConfirm();
  };

  return (
    <Show
      when={isMobile()}
      fallback={
        <Dialog
          class="w-88"
          open={props.open}
          onOpenChange={(open) => !open && props.onClose()}
        >
          <Panel depth={2} class="max-w-[calc(100vw-2rem)] rounded-xl text-ink">
            <Panel.Header class="gap-1 px-2">
              {/* Autofocus must not open a tooltip that consumes the first Escape. */}
              <Dialog.CloseButton
                as={Button}
                aria-label={props.closeLabel ?? `Close ${props.title}`}
                variant="ghost"
                size="icon-sm"
              >
                <CloseIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
              </Dialog.CloseButton>
              <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
                {props.title}
              </Dialog.Title>
            </Panel.Header>
            <Panel.Body class="flex flex-col gap-3 p-3">
              <RadioGroup
                value={props.scope}
                onChange={onScopeChange}
                aria-label={props.scopeLabel ?? 'Apply changes to'}
                class="max-w-80 text-sm text-ink-muted"
              >
                <For each={props.options}>
                  {(option) => (
                    <RadioGroup.Item value={option.scope}>
                      <RadioGroup.ItemControl />
                      <RadioGroup.ItemLabel>
                        {option.label}
                      </RadioGroup.ItemLabel>
                    </RadioGroup.Item>
                  )}
                </For>
              </RadioGroup>
              {props.children}
              <div class="flex justify-end gap-1 pt-2">
                <Button variant="ghost" onClick={props.onClose}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  disabled={props.pending}
                  onClick={onConfirm}
                >
                  {props.confirmLabel}
                </Button>
              </div>
            </Panel.Body>
          </Panel>
        </Dialog>
      }
    >
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={(open) => !open && props.onClose()}
        preventScroll={false}
        preventScrollbarShift={false}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content
            aria-label={props.title}
            class="overflow-hidden"
          >
            <MobileDrawer.Handle class="pb-1" />
            <div class="flex shrink-0 items-center justify-between gap-3 px-6 pb-4">
              <h2 class="text-lg font-semibold text-ink">{props.title}</h2>
              <MobileDrawer.Close
                as={Button}
                variant="ghost"
                size="icon-sm"
                aria-label={props.closeLabel ?? `Close ${props.title}`}
                class="size-11 shrink-0 rounded-full bg-ink/6"
              >
                <CloseIcon class="size-5" />
              </MobileDrawer.Close>
            </div>
            <MobileDrawer.ScrollBody>
              <Show when={props.description}>
                <p class="px-6 pb-3 text-sm text-ink-muted">
                  {props.description}
                </p>
              </Show>
              <MobileDrawer.Section>
                <RadioGroup
                  value={props.scope}
                  onChange={onScopeChange}
                  aria-label={props.scopeLabel ?? 'Apply changes to'}
                  class="flex flex-col gap-1"
                >
                  <For each={props.options}>
                    {(option) => (
                      <RadioGroup.Item
                        value={option.scope}
                        class="relative rounded-[20px] text-ink data-checked:bg-ink/8 focus-within:outline-2 focus-within:outline-accent"
                      >
                        <RadioGroup.ItemLabel class="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-base">
                          {option.label}
                          <RadioGroup.ItemControl class="flex size-5 items-center justify-center border-0 bg-transparent data-checked:border-0 data-checked:bg-transparent">
                            <RadioGroup.ItemIndicator>
                              <CheckIcon class="size-5 text-accent" />
                            </RadioGroup.ItemIndicator>
                          </RadioGroup.ItemControl>
                        </RadioGroup.ItemLabel>
                      </RadioGroup.Item>
                    )}
                  </For>
                </RadioGroup>
              </MobileDrawer.Section>
              {props.children}
              <div class="flex gap-3 px-6 pt-5 pb-2">
                <Button
                  variant="ghost"
                  class="min-h-11 flex-1"
                  onClick={props.onClose}
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  class="min-h-11 flex-1"
                  disabled={props.pending}
                  onClick={onConfirm}
                >
                  {props.mobileConfirmLabel ?? props.confirmLabel}
                </Button>
              </div>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
