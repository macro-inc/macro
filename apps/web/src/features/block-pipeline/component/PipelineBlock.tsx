import { crmPipelineContent } from '@app/features/crm/crm-hosted-content';
import { RedirectSplit } from '@components/app/split-layout/split-router/app-route-shell';
import { useBlockId } from '@core/block';

/** Routed opens redirect before mounting this; anything else lands here. */
export default function PipelineBlock() {
  return <RedirectSplit to={crmPipelineContent(useBlockId())} mergeHistory />;
}
