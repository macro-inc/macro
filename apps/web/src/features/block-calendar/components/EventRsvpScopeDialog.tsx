import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { RadioGroup } from '@kobalte/core/radio-group';
import CheckIcon from '@phosphor/check.svg';
import CloseIcon from '@phosphor/x.svg';
import type { CalendarRsvpScope } from '@service-email/client';
import { Button, Dialog, Panel } from '@ui';
import { For, Show } from 'solid-js';

const SCOPE_OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'all', label: 'All events' },
] as const satisfies readonly {
  scope: CalendarRsvpScope;
  label: string;
}[];

/** The caller owns the pending response; dismissing never submits it. */
export function EventRsvpScopeDialog(props: {
  open: boolean;
  scope: CalendarRsvpScope;
  onScopeChange: (scope: CalendarRsvpScope) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Show
      when={isMobile()}
      fallback={
        <Dialog
          open={props.open}
          onOpenChange={(open) => !open && props.onClose()}
        >
          <Panel depth={2} class="max-w-[calc(100vw-2rem)] rounded-xl text-ink">
            <Panel.Header class="gap-1 px-2">
              <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                <CloseIcon />
              </Dialog.CloseButton>
              <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
                RSVP to recurring event
              </Dialog.Title>
            </Panel.Header>
            <Panel.Body class="flex flex-col gap-3 p-3">
              <div class="flex max-w-80 flex-col gap-2 text-sm text-ink-muted">
                <For each={SCOPE_OPTIONS}>
                  {(option) => (
                    <label class="flex items-center gap-2">
                      <input
                        type="radio"
                        name="rsvp-scope"
                        checked={props.scope === option.scope}
                        onChange={() => props.onScopeChange(option.scope)}
                      />
                      {option.label}
                    </label>
                  )}
                </For>
              </div>
              <div class="flex justify-end gap-1 pt-2">
                <Button
                  variant="ghost"
                  class="rounded-lg"
                  onClick={props.onClose}
                >
                  Cancel
                </Button>
                <Button
                  variant="accent"
                  class="rounded-lg"
                  onClick={props.onConfirm}
                >
                  OK
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
            aria-label="RSVP to recurring event"
            class="overflow-hidden"
          >
            <MobileDrawer.Handle class="pb-1" />
            <div class="flex shrink-0 items-center justify-between gap-3 px-6 pb-4">
              <h2 class="text-lg font-semibold text-ink">
                RSVP to recurring event
              </h2>
              <MobileDrawer.Close
                as={Button}
                variant="ghost"
                size="icon-sm"
                aria-label="Close RSVP"
                class="size-11 shrink-0 rounded-full bg-ink/6"
              >
                <CloseIcon class="size-5" />
              </MobileDrawer.Close>
            </div>
            <MobileDrawer.ScrollBody>
              <p class="px-6 pb-3 text-sm text-ink-muted">
                Apply your response to:
              </p>
              <MobileDrawer.Section>
                <RadioGroup
                  value={props.scope}
                  onChange={(value) => {
                    const option = SCOPE_OPTIONS.find(
                      (option) => option.scope === value
                    );
                    if (option) props.onScopeChange(option.scope);
                  }}
                  aria-label="Response applies to"
                  class="flex flex-col gap-1"
                >
                  <For each={SCOPE_OPTIONS}>
                    {(option) => (
                      <RadioGroup.Item
                        value={option.scope}
                        class="relative rounded-[20px] text-ink data-checked:bg-ink/8 focus-within:outline-2 focus-within:outline-accent"
                      >
                        <RadioGroup.ItemInput />
                        <RadioGroup.ItemLabel class="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-base">
                          {option.label}
                          <RadioGroup.ItemControl class="flex size-5 items-center justify-center">
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
              <div class="flex gap-3 px-6 pt-5 pb-2">
                <Button
                  variant="ghost"
                  class="min-h-11 flex-1 rounded-full bg-ink/6"
                  onClick={props.onClose}
                >
                  Cancel
                </Button>
                <Button
                  variant="cta"
                  class="min-h-11 flex-1 rounded-full"
                  onClick={props.onConfirm}
                >
                  Save response
                </Button>
              </div>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
