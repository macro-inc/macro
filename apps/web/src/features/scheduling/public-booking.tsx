import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCalendarScheduling } from '@core/constant/featureFlags';
import { useLocation, useNavigate } from '@solidjs/router';
import { Show, Suspense } from 'solid-js';
import {
  createBookingReceiptSource,
  createPublicBookingSource,
  usePublicProfileQuery,
} from './queries/public';
import { BookingReceiptView } from './views/booking-receipt-view';
import { PublicBookingView } from './views/public-booking-view';

type BookingPageParams = { profile: string; slug?: string };

function BookingPageContent(params: BookingPageParams) {
  const navigate = useNavigate();
  const profile = usePublicProfileQuery(() => params.profile);
  const source = createPublicBookingSource();
  return (
    <Show
      when={profile.isSuccess ? profile.data : undefined}
      fallback={
        <div class="p-12 text-center text-ink-muted">
          {profile.isError
            ? 'This booking page is unavailable.'
            : 'Loading booking page…'}
        </div>
      }
    >
      {(p) => (
        <Show
          when={
            !params.slug || p().eventTypes.some((e) => e.slug === params.slug)
          }
          fallback={
            <p class="p-12 text-center">
              This event is no longer accepting bookings.
            </p>
          }
        >
          <PublicBookingView
            profile={p()}
            event={p().eventTypes.find((e) => e.slug === params.slug)}
            source={source}
            onEvent={(slug) => navigate(`/book/${params.profile}/${slug}`)}
            onReceipt={(r) => navigate(`/booking/${r.booking.id}#${r.token}`)}
          />
        </Show>
      )}
    </Show>
  );
}
export function PublicBookingPage(props: BookingPageParams) {
  const scheduling = useFeatureFlag(enableCalendarScheduling);
  return (
    <Show
      when={scheduling().enabled}
      fallback={
        <p class="p-12 text-center text-ink-muted">
          {scheduling().loading
            ? 'Loading…'
            : 'This booking page is unavailable.'}
        </p>
      }
    >
      <Suspense fallback={<p class="p-12">Loading…</p>}>
        <BookingPageContent profile={props.profile} slug={props.slug} />
      </Suspense>
    </Show>
  );
}

function ReceiptContent(params: { id: string }) {
  const location = useLocation();
  const token = () => location.hash.slice(1);
  const source = createBookingReceiptSource(() => params.id, token);
  return (
    <BookingReceiptView
      receipt={source.receipt.isSuccess ? source.receipt.data : undefined}
      unavailable={source.receipt.isError}
      cancel={source.cancel}
      loadSlots={source.replacementSlots}
      reschedule={source.reschedule}
    />
  );
}

export function BookingReceiptPage(props: { id: string }) {
  return (
    <Suspense fallback={<p class="p-12">Loading…</p>}>
      <ReceiptContent id={props.id} />
    </Suspense>
  );
}
