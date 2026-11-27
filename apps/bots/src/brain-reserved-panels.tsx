import { createResource, Show } from 'solid-js';
import { BrainAccess } from './brain-access';
import type { BrainScope } from './brain-model';

async function loadAccessFixture() {
  if (!__BOTS_FIXTURES__) return;

  try {
    const [{ createBrainAccessFixture }, { fleetViewer }] = await Promise.all([
      import('./brain-access-fixture'),
      import('./fleet-fixture'),
    ]);

    return createBrainAccessFixture({
      teamId: fleetViewer.teamId,
      teamName: fleetViewer.teamName,
      viewerId: fleetViewer.viewerId,
      role: 'admin',
    });
  } catch {
    return;
  }
}

export function AccessPanel(props: { scope: BrainScope }) {
  const [source] = createResource(loadAccessFixture);

  return (
    <Show
      when={source()}
      fallback={
        <section class="panel brain-section">
          <h2>Access</h2>
          <p class="brain-empty">
            {source.loading ? 'Loading access…' : 'Access is unavailable.'}
          </p>
        </section>
      }
    >
      {(ready) => <BrainAccess scope={props.scope} source={ready()} />}
    </Show>
  );
}
