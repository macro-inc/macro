import UsersThree from '@phosphor/users-three.svg';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, Show } from 'solid-js';
import { AudiencePanel } from '../components/share/audience-panel';
import {
  type FormMetadataPatch,
  useFormContext,
} from '../context/form-context';
import {
  instantFromLocalInput,
  localInputFromInstant,
} from '../core/date-answers';
import type { FormDetail } from '../core/form-model';
import { createAudienceChange } from '../primitives/create-audience-change';

/**
 * The Share tab (RFC 02 §2, §6): who can respond, the respond link, whether
 * the form takes responses and until when, and the people it is shared with
 * through the share dialog.
 */
export function ShareTabView(props: {
  detail: FormDetail;
  respondLink: string;
  onOpenShare: () => void;
  /** The form went to the trash; the host closes it. */
  onTrashed: () => void;
}) {
  const context = useFormContext();
  const form = () => props.detail.form;
  const isOwner = () => props.detail.access === 'owner';
  const canEdit = () => props.detail.access !== 'view';
  const [pending, setPending] = createSignal(false);

  async function moveToTrash() {
    const confirmed = await context.confirm({
      title: `Move “${form().name}” to the trash?`,
      body: 'It stops taking responses. Its database and every response row stay where they are.',
      confirmLabel: 'Move to trash',
      tone: 'danger',
    });
    if (!confirmed) return;
    const result = await context.trashForm(form().id);
    if (result.isErr()) {
      context.notify.failure(
        `The form wasn’t moved to the trash: ${result.error.message}`
      );
      return;
    }
    context.notify.success('Form moved to the trash.');
    props.onTrashed();
  }

  async function update(patch: FormMetadataPatch, what: string) {
    setPending(true);
    const result = await context.updateMetadata(form().id, patch);
    setPending(false);
    if (result.isErr())
      context.notify.failure(`${what} wasn’t saved: ${result.error.message}`);
  }

  const audience = createAudienceChange({
    detail: () => props.detail,
    updateMetadata: context.updateMetadata,
    notify: context.notify,
  });

  return (
    <div class="h-full min-h-0 overflow-y-auto bg-canvas-base touch:pb-(--mobile-content-inset-bottom)">
      <div class="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 py-6">
        <div class="rounded-xl border border-edge bg-surface p-4">
          <AudiencePanel
            audience={form().audience}
            canChange={isOwner()}
            respondLink={props.respondLink}
            pending={pending() || audience.pending()}
            onChange={(next) => void audience.change(next)}
          />
        </div>
        <div class="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4">
          <h3 class="text-sm font-semibold text-ink">Responses</h3>
          <ToggleSwitch
            size="md"
            label="Accepting responses"
            labelClass="text-sm text-ink"
            checked={form().status === 'open'}
            disabled={!isOwner() || pending()}
            onChange={(open) =>
              void update(
                { status: open ? 'open' : 'closed' },
                'Accepting responses'
              )
            }
          />
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium text-ink-muted">
              Close automatically
            </span>
            <span class="flex items-center gap-2">
              <input
                type="datetime-local"
                value={
                  form().closesAt
                    ? localInputFromInstant(form().closesAt ?? '')
                    : ''
                }
                disabled={!isOwner() || pending()}
                class="h-9 rounded-md border border-edge-muted bg-input px-2.5 text-sm text-ink outline-none focus:border-edge-focus disabled:opacity-60"
                onChange={(event) => {
                  const closesAt = instantFromLocalInput(
                    event.currentTarget.value
                  );
                  if (closesAt) void update({ closesAt }, 'The closing date');
                }}
              />
              <Show when={form().closesAt && isOwner()}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending()}
                  onClick={() =>
                    void update({ closesAt: null }, 'The closing date')
                  }
                >
                  Clear
                </Button>
              </Show>
            </span>
          </label>
          <ToggleSwitch
            size="md"
            label="Show results to respondents"
            labelClass="text-sm text-ink"
            checked={form().tallyVisible}
            disabled={!isOwner() || pending()}
            onChange={(tallyVisible) =>
              void update({ tallyVisible }, 'Showing results')
            }
          />
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium text-ink-muted">
              Confirmation message
            </span>
            <textarea
              rows={2}
              value={form().confirmationMessage}
              placeholder="Your response is saved."
              maxlength={2000}
              disabled={!canEdit()}
              class="w-full resize-y rounded-md border border-edge-muted bg-input px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60"
              onBlur={(event) => {
                const confirmationMessage = event.currentTarget.value;
                if (confirmationMessage !== form().confirmationMessage)
                  void update(
                    { confirmationMessage },
                    'The confirmation message'
                  );
              }}
            />
          </label>
          <Show when={!isOwner()}>
            <p class="text-xs text-ink-muted">
              Only the owner can change who responds, close the form or show
              results.
            </p>
          </Show>
        </div>
        <div class="flex items-center gap-3 rounded-xl border border-edge bg-surface p-4">
          <UsersThree
            class="size-5 shrink-0 text-ink-muted"
            aria-hidden="true"
          />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm font-medium text-ink">
              People and channels
            </span>
            <span class="text-xs text-ink-muted">
              Posting the form in a channel lets its members respond.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={props.onOpenShare}>
            Manage access
          </Button>
        </div>
        <Show when={isOwner()}>
          <div class="flex items-center gap-3 rounded-xl border border-edge bg-surface p-4">
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="text-sm font-medium text-ink">Move to trash</span>
              <span class="text-xs text-ink-muted">
                The database and its rows are kept.
              </span>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void moveToTrash()}
            >
              Move to trash
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}
