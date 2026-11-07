import '@app/index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RoutinePayloadTests } from '../components/routine-payload-tests';
import { RoutineTriggers } from '../components/routine-triggers';
import { RoutineWebhookUrl } from '../components/routine-webhook-url';
import {
  eventScopeKind,
  type RoutineTriggerDraft,
} from '../core/routine-triggers';
import type { RoutineWebhookState } from '../core/webhook';

const URL_PREFIX =
  'https://gateway.macro.com/scheduled-action/scheduled-actions/webhooks/';
const TOKEN = `mrw_${'0'.repeat(12)}_${'0'.repeat(64)}`;

/** A saved routine's URL, made and deleted in memory as the service would. */
function webhookState() {
  const [webhook, setWebhook] =
    createSignal<RoutineWebhookState['webhook']>(null);
  const [createdUrl, setCreatedUrl] = createSignal<string>();
  return (): RoutineWebhookState => ({
    webhook: webhook(),
    createdUrl: createdUrl(),
    failed: false,
    pending: false,
    create: () => {
      setWebhook({
        tokenPrefix: TOKEN.slice(0, 16),
        createdAt: '2026-11-07T09:00:00Z',
      });
      setCreatedUrl(`${URL_PREFIX}${TOKEN}`);
    },
    remove: () => {
      setWebhook(null);
      setCreatedUrl(undefined);
    },
  });
}

function Fixture() {
  const [triggers, setTriggers] = createSignal<RoutineTriggerDraft[]>([]);
  const state = webhookState();
  const slots = {
    renderEventLabel: () => <>Everything</>,
    renderEventScope: () => null,
    renderEventSettings: (
      trigger: () => Extract<RoutineTriggerDraft, { kind: 'event' }>,
      change: (
        patch: Partial<Extract<RoutineTriggerDraft, { kind: 'event' }>>
      ) => void
    ) =>
      eventScopeKind(trigger()) === 'WEBHOOK' ? (
        <>
          <RoutineWebhookUrl state={state()} />
          <RoutinePayloadTests
            subject="JSON body"
            pathPlaceholder="status"
            listExample="alerts.*.severity"
            tests={trigger().match ?? []}
            onChange={(match) => change({ match })}
          />
        </>
      ) : null,
  };
  return (
    <main class="mx-auto grid max-w-xl gap-3 p-4">
      <h1 class="text-sm font-semibold">When</h1>
      <div class="rounded-xl border border-edge-muted p-4">
        <RoutineTriggers
          layout="rows"
          triggers={triggers()}
          onChange={setTriggers}
          {...slots}
        />
      </div>
      <RoutineTriggers
        layout="add"
        triggers={triggers()}
        onChange={setTriggers}
        {...slots}
      />
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
