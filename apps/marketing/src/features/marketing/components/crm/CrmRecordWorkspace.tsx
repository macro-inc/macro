import { Match, Switch } from 'solid-js';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
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
  section?: CompanySection;
  onSectionChange?: (section: CompanySection) => void;
}) {
  const w = props.workspace;
  return (
    <Switch
      fallback={
        <WorkspaceCompanies
          workspace={w}
          initialPanelOpen={props.initialPanelOpen}
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
