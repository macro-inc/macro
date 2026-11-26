import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { useCrmContext } from './context/crm-context';
import type { AddToPipelineRecord } from './context/pipelines';
import { createAddToPipeline } from './primitives/add-to-pipeline';
import { AddToPipelineMenu } from './views/add-to-pipeline';
import { AddToPipelineMenu as MobileAddToPipelineMenu } from './views/mobile/add-to-pipeline';

/**
 * A record page's Add to pipeline button. It reads nothing until its menu
 * first opens; touch devices drill into a pipeline's stages in place.
 */
export function AddToPipeline(props: { record: AddToPipelineRecord }) {
  const context = useCrmContext();
  const controller = createAddToPipeline(
    {
      createSource: context.createAddToPipeline,
      feedback: context.feedback,
    },
    () => props.record
  );
  return (
    <Show
      when={isTouchDevice()}
      fallback={<AddToPipelineMenu controller={controller} />}
    >
      <MobileAddToPipelineMenu controller={controller} />
    </Show>
  );
}
