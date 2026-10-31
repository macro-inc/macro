import { onCleanup, Show } from 'solid-js';
import { SoupViewStateProvider } from '../next-soup/soup-view/soup-view-context';
import { ViewTour } from '../tours/ViewTour';
import { CrmProvider } from './context/crm-context';
import {
  type CrmRoute,
  CrmWorkspaceProvider,
} from './context/workspace-context';
import type { CrmViewConfig } from './core/saved-view';
import { createAppCrmContext } from './crm-adapter';
import { companiesTour } from './tour';
import { Companies } from './views/companies';
import { CrmDefaultViewLoader } from './views/default-view';
import { createCrmWorkspace } from './workspace-adapter';

export function Crm(props: { initialView?: CrmViewConfig; route: CrmRoute }) {
  const crm = createAppCrmContext();
  onCleanup(crm.registerTaskComposerRecord(() => undefined));
  const workspace = createCrmWorkspace(crm, props.route, props.initialView);
  return (
    <CrmProvider value={crm}>
      <SoupViewStateProvider state={workspace.state}>
        <CrmWorkspaceProvider value={workspace.context}>
          <Show when={workspace.applyDefaultCrmView}>
            <CrmDefaultViewLoader
              withReplaceHistory={workspace.withReplaceHistory}
            />
          </Show>
          <Companies />
          <ViewTour tour={companiesTour} />
        </CrmWorkspaceProvider>
      </SoupViewStateProvider>
    </CrmProvider>
  );
}
