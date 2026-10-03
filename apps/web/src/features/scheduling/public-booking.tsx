import { useLocation, useNavigate, useParams } from '@solidjs/router';
import { Show, Suspense } from 'solid-js';
import {
  createBookingReceiptSource,
  createPublicBookingSource,
  usePublicProfileQuery,
} from './queries/public';
import { BookingReceiptView } from './views/booking-receipt-view';
import { PublicBookingView } from './views/public-booking-view';

function BookingPageContent() {
  const params = useParams<{ profile: string; slug?: string }>();
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
export function PublicBookingPage() {
  return (
    <Suspense fallback={<p class="p-12">Loading…</p>}>
      <BookingPageContent />
    </Suspense>
  );
}

function ReceiptContent() {
  const params = useParams<{ id: string }>();
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

export function BookingReceiptPage() {
  return (
    <Suspense fallback={<p class="p-12">Loading…</p>}>
      <ReceiptContent />
    </Suspense>
  );
}
