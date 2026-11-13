import { type Accessor, Match, Switch } from 'solid-js';
import {
  DashboardEmpty,
  DashboardError,
  DashboardLoading,
  DashboardNoAccess,
} from '../../components/dashboard-states';
import type { DashboardView } from '../../primitives/dashboard-view';
import { DashboardPanes } from './dashboard-panes';

/** The dashboard region: its panes, or why there are none. */
export function DashboardBody(props: {
  view: Accessor<DashboardView>;
  onRetry: () => void;
}) {
  const ready = () => {
    const current = props.view();
    return current.t === 'ready' ? current.dashboard : undefined;
  };

  return (
    <Switch>
      <Match when={props.view().t === 'loading'}>
        <DashboardLoading />
      </Match>
      <Match when={props.view().t === 'empty'}>
        <DashboardEmpty />
      </Match>
      <Match when={props.view().t === 'noAccess'}>
        <DashboardNoAccess />
      </Match>
      <Match when={props.view().t === 'error'}>
        <DashboardError onRetry={props.onRetry} />
      </Match>
      <Match when={ready()}>
        {(dashboard) => <DashboardPanes view={dashboard().view} />}
      </Match>
    </Switch>
  );
}
