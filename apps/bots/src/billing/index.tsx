import { useLocation } from '@solidjs/router';
import { createResource, Match, Switch } from 'solid-js';
import { session } from '../session';
import type {
  BillingReader,
  BillingReading,
  BillingSnapshot,
  BillingTeam,
} from './read';
import { unavailableBilling } from './read';
import { ReadState } from './read-state';
import { Invoices, ModeledUsage, Usage } from './sections';
import './style.css';

type BillingPage = BillingReading<{
  team: BillingTeam;
  snapshot: BillingSnapshot;
}>;

async function readPage(
  team: BillingTeam,
  read: BillingReader
): Promise<BillingPage> {
  const result = await read(team);

  if (result.status !== 'ready') return result;

  return { status: 'ready', value: { team, snapshot: result.value } };
}

const billingMessages = {
  pending: 'Billing is pending.',
  denied: 'You don’t have access to team billing.',
  empty: 'No billing observations for this team.',
  unavailable: 'Team billing is unavailable in this build.',
};

export default function Billing() {
  const location = useLocation();
  const [page] = createResource(
    () => (__BOTS_FIXTURES__ ? location.search : ''),
    async (search): Promise<BillingPage> => {
      if (__BOTS_FIXTURES__) {
        const { fixtureBilling, sampleTeam } = await import('./fixture');
        const scenario = new URLSearchParams(search).get('billing-fixture');
        return readPage(sampleTeam, fixtureBilling(scenario));
      }

      const identity = await session.getSession();
      if (identity.status !== 'signed-in') return { status: 'unavailable' };

      return readPage(identity.team, unavailableBilling);
    }
  );

  return (
    <section class="billing" aria-labelledby="tower-billing-title">
      <div class="billing-heading">
        <h1 id="tower-billing-title">Billing</h1>
      </div>
      <Switch>
        <Match when={page.loading}>
          <p class="billing-note" role="status">
            Loading billing…
          </p>
        </Match>
        <Match when={page.error}>
          <p class="billing-note" role="status">
            {billingMessages.unavailable}
          </p>
        </Match>
        <Match when={page()}>
          {(result) => (
            <ReadState result={result()} messages={billingMessages}>
              {(value) => (
                <div class="billing-content">
                  <p class="billing-team">{value().team.name}</p>
                  <Usage result={value().snapshot.usage} />
                  <Invoices result={value().snapshot.invoices} />
                  <ModeledUsage result={value().snapshot.modeledSpend} />
                </div>
              )}
            </ReadState>
          )}
        </Match>
      </Switch>
    </section>
  );
}
