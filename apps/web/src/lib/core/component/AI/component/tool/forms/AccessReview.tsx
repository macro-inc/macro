import { createBookingEventSource } from '@app/features/block-form/queries/booking-sources';
import { schedulingLink } from '@app/features/scheduling/scheduling';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableForms } from '@core/constant/featureFlags';
import { useListChannelsQuery } from '@queries/channel/channels';
import { useFormAccessReviewQuery } from '@queries/storage/form-tool-review';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import { Button } from '@ui';
import { createEffect, createSignal, Show, Suspense } from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';
import { FormAccessComposer } from './AccessComposer';
import type { FormAccessArgs } from './types';

type Props = {
  initialData: FormAccessArgs;
  sink: UserToolReviewSink<FormAccessArgs>;
};
function Unavailable(props: Props & { message: string; retry?: () => void }) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [done, setDone] = createSignal(false);
  async function cancel() {
    if (!props.sink.canAct() || pending() || done()) return;
    setPending(true);
    try {
      const finished = await props.sink.onReject();
      setDone(finished);
      if (!finished) setError('Could not cancel the review. Try again.');
    } catch {
      setError('Could not cancel the review. Try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div class="p-3 text-sm text-ink-muted">
      <p>{done() ? 'Review cancelled.' : props.message}</p>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show when={props.retry}>
        <Button variant="ghost" onClick={() => props.retry?.()}>
          Try again
        </Button>
      </Show>
      <Button
        variant="ghost"
        disabled={!props.sink.canAct() || pending() || done()}
        onClick={() => void cancel()}
      >
        Cancel review
      </Button>
    </div>
  );
}
function Loaded(props: Props & { detail: FormDetail; acceptReady: boolean }) {
  const channels = useListChannelsQuery();
  const target = () =>
    props.detail.sections.find((section) => section.kind === 'booking')
      ?.target ?? undefined;
  const booking = createBookingEventSource(target);
  const destination = () => {
    const current = booking.value();
    return current
      ? {
          title: current.event.title,
          url: schedulingLink(current.profile, current.event.slug),
        }
      : undefined;
  };
  return (
    <FormAccessComposer
      {...props}
      channelNames={
        new Map(
          channels.isSuccess
            ? channels.data.map((channel) => [
                channel.id,
                channel.name ?? 'Unnamed channel',
              ])
            : []
        )
      }
      booking={destination()}
    />
  );
}
function Content(props: Props) {
  const enabled = useFeatureFlag(enableForms);
  const query = useFormAccessReviewQuery(() =>
    enabled().enabled ? props.initialData : undefined
  );
  const [reviewed, setReviewed] = createSignal<FormDetail>();
  const ready = () =>
    query.isSuccess && query.isFetchedAfterMount && !query.isFetching;
  createEffect(() => {
    if (ready()) setReviewed(query.data);
  });
  return (
    <Show
      when={enabled().enabled}
      fallback={
        <Unavailable
          {...props}
          message="Forms is not enabled for this account."
        />
      }
    >
      <Show
        when={reviewed()}
        fallback={
          <Unavailable
            {...props}
            message={
              query.isError
                ? 'Could not load the form. Sharing is paused until its current settings are available.'
                : 'Loading form settings…'
            }
            retry={query.isError ? () => void query.refetch() : undefined}
          />
        }
      >
        {(detail) => (
          <>
            <Show when={!ready()}>
              <p role="status" class="p-3 text-sm text-ink-muted">
                {query.isError
                  ? 'Could not refresh this review. Your edits are preserved.'
                  : 'Refreshing form contents. Your edits are preserved.'}
              </p>
            </Show>
            <Show when={query.isError}>
              <Button variant="ghost" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </Show>
            <Loaded {...props} detail={detail()} acceptReady={ready()} />
          </>
        )}
      </Show>
    </Show>
  );
}
/** Keep network loading inside the review, preserving the surrounding transcript. */
export function FormAccessReview(props: Props) {
  return (
    <Suspense
      fallback={
        <p class="p-3 text-sm text-ink-muted">Loading form settings…</p>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}
