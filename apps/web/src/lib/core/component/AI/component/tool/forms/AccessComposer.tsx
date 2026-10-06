import { rulesSentence } from '@app/features/block-form/core/rule-sentence';
import { toFormDetail } from '@app/features/block-form/queries/form-detail';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import { Button } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';
import type { FormAccessArgs } from './types';

/** Local datetime input preserves the reviewed instant across time zones. */
function localDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function FormAccessComposer(props: {
  initialData: FormAccessArgs;
  detail: FormDetail;
  acceptReady?: boolean;
  channelNames?: ReadonlyMap<string, string>;
  booking?: { title: string; url: string };
  sink: UserToolReviewSink<FormAccessArgs>;
}) {
  const [draft, setDraft] = createSignal({
    ...props.initialData.draft,
    channelGrants: props.initialData.draft.channelGrants ?? [],
  });
  const [deadline, setDeadline] = createSignal(
    localDate(props.initialData.draft.closesAt)
  );
  const [pending, setPending] = createSignal(false);
  const [finished, setFinished] = createSignal(false);
  const [error, setError] = createSignal('');
  const owner = () => props.detail.access === 'owner';
  const cannotDecide = () => !props.sink.canAct() || pending() || finished();
  const locked = () =>
    cannotDecide() || !owner() || props.acceptReady === false;
  const detail = () => toFormDetail(props.detail);
  const columns = () =>
    new Map(detail().columns.map((column) => [column.id, column]));
  const args = (): FormAccessArgs => ({ ...props.initialData, draft: draft() });
  const update = (next: Partial<FormAccessArgs['draft']>) => {
    if (locked()) return;
    setDraft((previous) => ({
      ...previous,
      ...next,
      channelGrants: next.channelGrants ?? previous.channelGrants,
    }));
    props.sink.onEdit?.(args());
  };
  async function decide(accept: boolean) {
    if (cannotDecide() || (accept && locked())) return;
    setError('');
    if (
      accept &&
      deadline() &&
      !Number.isFinite(new Date(deadline()).getTime())
    ) {
      setError('Enter a valid closing date and time.');
      return;
    }
    setPending(true);
    try {
      const done = accept
        ? await props.sink.onExecute(args())
        : await props.sink.onReject();
      setFinished(done);
      if (!done)
        setError('Could not finish this review. Your changes are preserved.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save sharing settings. Try again.'
      );
    } finally {
      setPending(false);
    }
  }
  onCleanup(() => props.sink.onDispose?.());
  return (
    <div
      class="min-w-0 rounded-xl border border-edge-muted bg-panel p-4 text-sm text-ink"
      data-form-access-review
    >
      <div class="mb-4">
        <h3 class="font-medium">Share {props.detail.form.name}</h3>
        <Show when={props.detail.form.description}>
          <p class="mt-1 text-ink-muted">{props.detail.form.description}</p>
        </Show>
        <a
          href={`/app/form/${props.detail.form.id}`}
          target="_blank"
          rel="noreferrer"
          class="mt-2 inline-block text-accent hover:underline"
        >
          Review form
        </a>
      </div>
      <div class="mb-4 space-y-2 rounded-lg border border-edge-muted bg-surface p-3">
        <For each={detail().layout.sections}>
          {(section) => (
            <div>
              <p class="font-medium">
                {section.title ||
                  (section.kind === 'gate'
                    ? 'Screener'
                    : section.kind === 'booking'
                      ? 'Booking'
                      : 'Questions')}
              </p>
              <Show when={section.kind === 'questions'}>
                <p class="text-ink-muted">
                  {section.questions
                    .map(
                      (question) =>
                        `${columns().get(question.columnId)?.name ?? 'Unavailable question'}${question.required ? ' (required)' : ''}`
                    )
                    .join(' · ')}
                </p>
              </Show>
              <Show when={section.kind === 'gate'}>
                <p class="text-ink-muted">
                  {rulesSentence(section.gateRules, columns())}
                </p>
              </Show>
              <Show when={section.kind === 'booking'}>
                <p class="text-ink-muted">
                  Shown after an accepted response. The booking link can also be
                  used independently.
                  <Show
                    when={props.booking}
                    fallback={
                      <span>
                        {' '}
                        Booking destination details are unavailable; review the
                        builder before sharing.
                      </span>
                    }
                  >
                    {(booking) => (
                      <a
                        class="ml-1 text-accent hover:underline"
                        href={booking().url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {booking().title}
                      </a>
                    )}
                  </Show>
                </p>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={!owner()}>
        <p role="status" class="mb-3 text-ink-muted">
          Only the form owner can change sharing.
        </p>
      </Show>
      <Show when={props.sink.lockedNotice()}>
        {(notice) => <p class="mb-3 text-ink-muted">{notice()}</p>}
      </Show>
      <Show when={error()}>
        <p role="alert" class="mb-3 text-failure">
          {error()}
        </p>
      </Show>
      <fieldset disabled={locked()} class="space-y-4 disabled:opacity-60">
        <label class="flex flex-col gap-1">
          Who can respond
          <select
            class="rounded-md border border-edge-muted bg-input p-2"
            value={draft().audience}
            onChange={(event) =>
              update({
                audience:
                  event.currentTarget.value === 'public' ? 'public' : 'members',
              })
            }
          >
            <option value="members">People with access, signed in</option>
            <option value="public">Anyone with the link</option>
          </select>
        </label>
        <p class="text-xs text-ink-muted">
          {draft().audience === 'public'
            ? 'Anyone with this link can submit anonymously. This does not give access to the response database.'
            : 'Respondents must sign in and have access to this form.'}
        </p>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft().status === 'open'}
            onChange={(event) =>
              update({
                status: event.currentTarget.checked ? 'open' : 'closed',
              })
            }
          />
          Accept responses
        </label>
        <label class="flex flex-col gap-1">
          Close at (your time zone)
          <input
            type="datetime-local"
            class="rounded-md border border-edge-muted bg-input p-2"
            value={deadline()}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setDeadline(value);
              if (!value) update({ closesAt: null });
              else if (Number.isFinite(new Date(value).getTime()))
                update({ closesAt: new Date(value).toISOString() });
            }}
          />
        </label>
        <Show
          when={
            draft().status === 'open' &&
            !!draft().closesAt &&
            new Date(draft().closesAt!).getTime() <= Date.now()
          }
        >
          <p class="text-xs text-ink-muted">
            This deadline has passed, so the form will stay closed to responses.
          </p>
        </Show>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft().tallyVisible}
            onChange={(event) =>
              update({ tallyVisible: event.currentTarget.checked })
            }
          />
          Let respondents see choice totals
        </label>
        <Show when={draft().channelGrants.length > 0}>
          <div class="space-y-2">
            <p class="font-medium">Channel access changes</p>
            <For each={draft().channelGrants}>
              {(grant, index) => (
                <div class="flex flex-wrap items-center gap-2 rounded-md border border-edge-muted bg-input p-2">
                  <span class="min-w-0 flex-1 break-all text-xs">
                    {props.channelNames?.get(grant.channelId) ??
                      `Unresolved channel (${grant.channelId})`}
                  </span>
                  <select
                    aria-label={`Channel ${grant.channelId} access`}
                    class="rounded-md border border-edge-muted bg-input p-1"
                    value={
                      grant.operation === 'remove' ? 'remove' : grant.access
                    }
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      update({
                        channelGrants: draft().channelGrants.map(
                          (item, position) =>
                            position !== index()
                              ? item
                              : value === 'remove'
                                ? {
                                    operation: 'remove',
                                    channelId: item.channelId,
                                  }
                                : {
                                    operation: 'upsert',
                                    channelId: item.channelId,
                                    access: value === 'edit' ? 'edit' : 'view',
                                  }
                        ),
                      });
                    }}
                  >
                    <option value="view">Can respond</option>
                    <option value="edit">Can edit</option>
                    <option value="remove">Remove access</option>
                  </select>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      update({
                        channelGrants: draft().channelGrants.filter(
                          (_, position) => position !== index()
                        ),
                      })
                    }
                  >
                    Keep unchanged
                  </Button>
                </div>
              )}
            </For>
            <Show
              when={draft().channelGrants.some(
                (grant) =>
                  grant.operation === 'upsert' && grant.access === 'edit'
              )}
            >
              <p class="text-xs text-ink-muted">
                Channel editors can change the form and read and edit its entire
                response database, including extra columns.
              </p>
            </Show>
            <p class="text-xs text-ink-muted">
              Other grants stay unchanged. This does not post a channel message
              or send invitations.
            </p>
          </div>
        </Show>
        <div class="break-all text-xs">
          <span class="text-ink-muted">Respondent link: </span>
          <a
            class="text-accent hover:underline"
            href={`/app/form/${props.detail.form.id}/respond`}
          >{`${location.origin}/app/form/${props.detail.form.id}/respond`}</a>
          <p class="mt-1 text-ink-muted">
            {draft().status === 'closed'
              ? 'The link will remain closed to responses.'
              : 'Availability also depends on the closing time and a valid saved form.'}
          </p>
        </div>
      </fieldset>
      <div class="flex justify-end gap-2 border-t border-edge-muted pt-3">
        <Button
          variant="ghost"
          disabled={cannotDecide()}
          onClick={() => void decide(false)}
        >
          Cancel review
        </Button>
        <Button
          variant="cta"
          disabled={locked()}
          onClick={() => void decide(true)}
        >
          {pending() ? 'Saving…' : 'Save sharing'}
        </Button>
      </div>
    </div>
  );
}
