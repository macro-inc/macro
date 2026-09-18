import { useLocation, useNavigate, useParams } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { Show, Suspense } from 'solid-js';
import { schedulingKeys } from './queries/keys';
import { publicSchedulingSource } from './queries/public';
import { BookingReceiptView } from './views/booking-receipt-view';
import { PublicBookingView } from './views/public-booking-view';

function BookingPageContent() {
  const params = useParams<{ profile: string; slug?: string }>();
  const navigate = useNavigate();
  const profile = useQuery(() => ({
    queryKey: schedulingKeys.publicProfile(params.profile).queryKey,
    queryFn: () => publicSchedulingSource.profile(params.profile),
    retry: false,
  }));
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
            source={publicSchedulingSource}
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
  const receipt = useQuery(() => ({
    queryKey: schedulingKeys.receipt(params.id, token()).queryKey,
    queryFn: () => publicSchedulingSource.receipt(params.id, token()),
    retry: false,
    gcTime: 0,
    refetchInterval: (q) =>
      q.state.data?.booking.status === 'processing' ||
      q.state.data?.booking.status === 'failed'
        ? 5000
        : false,
  }));
  return (
    <BookingReceiptView
      receipt={receipt.isPending ? undefined : receipt.data}
      unavailable={receipt.isError}
      cancel={async () => {
        await publicSchedulingSource.cancel(params.id, token());
        await receipt.refetch();
      }}
      loadSlots={(date) =>
        publicSchedulingSource.replacementSlots(params.id, token(), date)
      }
      reschedule={async (start) => {
        await publicSchedulingSource.reschedule(params.id, token(), start);
        await receipt.refetch();
      }}
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
