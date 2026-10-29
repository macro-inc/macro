import { type JSX, Match, Switch } from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import type { ChannelComposerHandle } from '../email/frozen/ChannelComposer';
import {
  type CompanySection,
  WorkspaceCompanies,
} from '../workspace/WorkspaceCompanies';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import '../email/email-demos.css';
import '../workspace/dummy-workspace.css';

/**
 * A company record whose linked emails and documents open in the same frame,
 * the way record rows open beside the record in the app.
 */
export function CrmRecordWorkspace(props: {
  workspace: DummyWorkspace;
  initialPanelOpen?: boolean;
  pipeline?: JSX.Element;
  hideCopyLink?: boolean;
  onComposerReady?: (handle: ChannelComposerHandle | undefined) => void;
  richComposer?: boolean;
  onOpenItem?: (view: WorkspaceView, id: string) => void;
  onOpenCall?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  section?: CompanySection;
  onSectionChange?: (section: CompanySection) => void;
}) {
  const w = props.workspace;
  return (
    <Switch
      fallback={
        <WorkspaceCompanies
          onComposerReady={props.onComposerReady}
          richComposer={props.richComposer}
          workspace={w}
          onOpenItem={props.onOpenItem}
          onOpenCall={props.onOpenCall}
          onOpenTask={props.onOpenTask}
          hideCopyLink={props.hideCopyLink}
          initialPanelOpen={props.initialPanelOpen}
          pipeline={() => props.pipeline}
          section={props.section}
          onSectionChange={props.onSectionChange}
        />
      }
    >
      <Match when={w.contentView() === 'email'}>
        <WorkspaceEmail workspace={w} tab="all" account="all" />
      </Match>
      <Match when={w.contentView() === 'documents'}>
        <WorkspaceDocuments workspace={w} />
      </Match>
    </Switch>
  );
}
