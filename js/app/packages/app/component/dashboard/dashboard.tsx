import { IndividualView } from '@app/component/dashboard/individual-view';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { TabsInset } from '@core/component/TabsInset';
import { createSignal, Match, Switch } from 'solid-js';

export function Dashboard() {
  const [view, setView] = createSignal<'team' | 'individual'>('team');

  return (
    <main class="relative h-full overflow-y-auto bg-surface">
      <SplitHeaderLeft>
        <div class="flex h-full items-center gap-3">
          <h1 class="text-base font-bold text-ink">Dashboard</h1>
          <TabsInset
            class="inline-flex h-auto"
            defaultValue="team"
            value={view()}
            onChange={setView}
            list={[
              { value: 'team', label: 'Team' },
              { value: 'individual', label: 'Individual' },
            ]}
          />
        </div>
      </SplitHeaderLeft>

      <div class="@container/dashboard px-0 pb-10 sm:px-8">
        <Switch>
          <Match when={view() === 'team'}>
            <div>Team</div>
          </Match>
          <Match when={true}>
            <IndividualView />
          </Match>
        </Switch>
      </div>
    </main>
  );
}
