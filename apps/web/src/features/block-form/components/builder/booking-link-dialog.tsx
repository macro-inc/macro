import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import CalendarCheck from '@phosphor/calendar-check.svg';
import { Button, Dialog, Panel } from '@ui';
import { For, Match, Switch } from 'solid-js';
import type { FormBookingLink } from '../../context/form-context';
import type { FormBookingTarget } from '../../core/form-model';

/** A booking picker that fits narrow form editors without a nested menu. */
export function BookingLinkDialog(props: {
  links: readonly FormBookingLink[] | undefined;
  failed: boolean;
  onChoose: (target: FormBookingTarget) => void;
  onCreate: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
      class="w-96 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <div class="flex flex-col gap-3 p-5">
            <Dialog.Title class="text-base font-semibold">
              Choose a booking link
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              Respondents can book after passing this form’s screeners.
            </Dialog.Description>
            <div class="flex max-h-[50dvh] flex-col gap-1 overflow-y-auto">
              <Switch>
                <Match when={props.failed}>
                  <p role="alert" class="text-sm text-failure-ink">
                    Your booking links couldn’t be loaded.
                  </p>
                </Match>
                <Match when={!props.links}>
                  <p role="status" class="text-sm text-ink-muted">
                    Loading booking links…
                  </p>
                </Match>
                <Match when={props.links?.length === 0}>
                  <p class="text-sm text-ink-muted">
                    You have no booking links yet.
                  </p>
                </Match>
                <Match when={props.links}>
                  {(links) => (
                    <For each={links()}>
                      {(link) => (
                        <Button
                          variant="ghost"
                          class="h-auto min-h-12 justify-start gap-2 py-2 text-left"
                          onClick={() => props.onChoose(link.target)}
                        >
                          <CalendarCheck class="size-4 shrink-0" />
                          <span class="flex min-w-0 flex-col">
                            <span class="truncate">{link.title}</span>
                            <span class="truncate text-xs font-normal text-ink-muted">
                              {link.durationMinutes} min · {link.owner}
                            </span>
                          </span>
                        </Button>
                      )}
                    </For>
                  )}
                </Match>
              </Switch>
            </div>
            <Button variant="outline" onClick={props.onCreate}>
              <ArrowSquareOut class="size-4" />
              Create a booking link
            </Button>
            <Button variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
