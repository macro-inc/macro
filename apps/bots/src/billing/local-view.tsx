import { createResource, Show } from 'solid-js';
import { session } from '../session';
import { readLocalCompute } from './local-read';
import { SignedBilling } from './signed-sections';

export default function LocalBilling() {
  const [viewer] = createResource(() => session.getSession());
  const verifiedTeam = () => {
    if (viewer.loading) return;
    const record = viewer();
    if (record?.status === 'signed-in') return record.team;
  };

  return (
    <section class="billing" aria-labelledby="tower-billing-title">
      <div class="billing-heading">
        <h1 id="tower-billing-title">Billing</h1>
      </div>
      <Show
        keyed
        when={verifiedTeam()}
        fallback={
          <p class="billing-note" role="status">
            {viewer.loading
              ? 'Loading billing…'
              : 'Team billing is unavailable without a verified local session.'}
          </p>
        }
      >
        {(team) => (
          <SignedBilling teamId={team.id} readCompute={readLocalCompute} />
        )}
      </Show>
    </section>
  );
}
