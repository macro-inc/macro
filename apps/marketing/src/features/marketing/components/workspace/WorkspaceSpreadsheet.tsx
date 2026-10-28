import ArrowLeft from '@phosphor/arrow-left.svg';
import Table from '@phosphor/table.svg';
import { Button } from '@ui';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewShell } from '../DemoWorkspaceChrome';
import HomepageSpreadsheet from '../HomepageSpreadsheet';

export function WorkspaceSpreadsheet(props: { workspace: DummyWorkspace }) {
  return (
    <>
      <ViewShell.TopBar>
        <Button
          variant="plain"
          size="icon-sm"
          label={
            props.workspace.view() === 'home' ? 'Back to Home' : 'Back to files'
          }
          onClick={() => props.workspace.backToCollection('documents')}
        >
          <ArrowLeft />
        </Button>
        <Table class="size-4 text-success" />
        <span class="text-sm">Customers to reach</span>
      </ViewShell.TopBar>
      <div class="sample-sheet-view">
        <HomepageSpreadsheet />
      </div>
    </>
  );
}
