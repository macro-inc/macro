import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import { homeSplitRoute } from '@app/routes/routes';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { lazy, onMount, Show, Suspense } from 'solid-js';

const Group = lazy(async () => ({
  default: (await import('./whatsapp-group')).WhatsAppGroup,
}));
export function WhatsAppGroupSkeleton() {
  return (
    <p role="status" class="p-6 text-sm text-ink-muted">
      Loading WhatsApp group…
    </p>
  );
}
function DisabledGroup() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: homeSplitRoute, params: {} }, { replace: true })
  );
  return null;
}
/** Gate before mounting any queries, including panes restored from session state. */
export function WhatsAppGroupEntry(props: { groupId: string }) {
  const flag = useFeatureFlag(enableWhatsappLinked);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<WhatsAppGroupSkeleton />}>
          <DisabledGroup />
        </Show>
      }
    >
      <Suspense fallback={<WhatsAppGroupSkeleton />}>
        <Group groupId={props.groupId} />
      </Suspense>
    </Show>
  );
}
