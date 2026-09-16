import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { Match, Switch } from 'solid-js';
import type { EntityDetailTarget } from './EntityDetailNavigationStack';

export type EntityDetailProps = {
  target: EntityDetailTarget;
};

function PreviewPanelEntityDetail(props: EntityDetailProps) {
  const orchestrator = useGlobalBlockOrchestrator();
  const panel = useSplitPanelOrThrow();

  return (
    <PreviewPanel
      selectedEntity={props.target}
      orchestrator={orchestrator}
      splitPanelContext={panel}
    />
  );
}

export function EntityDetail(props: EntityDetailProps) {
  return (
    <Switch>
      <Match when={true}>
        <PreviewPanelEntityDetail target={props.target} />
      </Match>
    </Switch>
  );
}
