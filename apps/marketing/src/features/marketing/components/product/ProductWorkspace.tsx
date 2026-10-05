import { Match, Switch } from 'solid-js';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { WorkspaceAgents } from '../workspace/WorkspaceAgents';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';

/** Local linked items open in the same demonstration, just as they do in Home. */
export function ProductWorkspace(props: { workspace: DummyWorkspace }) {
  const w = props.workspace;
  return (
    <Switch fallback={<WorkspaceChannel workspace={w} />}>
      <Match when={w.contentView() === 'documents'}>
        <WorkspaceDocuments workspace={w} />
      </Match>
      <Match when={w.contentView() === 'tasks'}>
        <WorkspaceTasks workspace={w} filter="all" />
      </Match>
      <Match when={w.contentView() === 'agents'}>
        <WorkspaceAgents workspace={w} />
      </Match>
      <Match when={w.contentView() === 'email'}>
        <WorkspaceEmail workspace={w} tab="important" account="all" />
      </Match>
    </Switch>
  );
}
