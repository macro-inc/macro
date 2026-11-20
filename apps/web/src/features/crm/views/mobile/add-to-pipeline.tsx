import { t } from '@app/lib/i18n';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ADD_TO_PIPELINE_FLOW } from '../../core/add-to-pipeline';
import type { TrackedPipeline } from '../../core/pipeline';
import type { AddToPipelineController } from '../../primitives/add-to-pipeline';
import {
  AddToPipelineFormHost,
  AddToPipelineTrigger,
  choiceDisabledReason,
  PipelineChoiceLabel,
  PipelineChoices,
  StageItems,
} from '../shared/add-to-pipeline';

/**
 * The touch Add to pipeline menu: phones have no submenus, so a pipeline's
 * stages replace the list in place, under a row back to the pipelines.
 */
export function AddToPipelineMenu(props: {
  controller: AddToPipelineController;
}) {
  const [stagesOf, setStagesOf] = createSignal<TrackedPipeline>();
  const recordType = () => props.controller.record().type;
  return (
    <>
      <Dropdown
        onOpenChange={(open) => {
          if (open) props.controller.load();
          else setStagesOf(undefined);
        }}
      >
        <AddToPipelineTrigger />
        <Dropdown.Content
          class="min-w-64 max-w-[calc(100vw-32px)]"
          aria-label={t('crm.addToPipeline')}
        >
          <Show
            when={stagesOf()}
            fallback={
              <Dropdown.Group>
                <PipelineChoices
                  controller={props.controller}
                  recordType={recordType()}
                >
                  {(choice) => (
                    <Dropdown.Item
                      disabledReason={choiceDisabledReason(choice)}
                      closeOnSelect={ADD_TO_PIPELINE_FLOW === 'form'}
                      onSelect={() =>
                        ADD_TO_PIPELINE_FLOW === 'stage'
                          ? setStagesOf(choice.pipeline)
                          : props.controller.openForm(choice.pipeline)
                      }
                    >
                      <PipelineChoiceLabel choice={choice} />
                      <Show
                        when={
                          ADD_TO_PIPELINE_FLOW === 'stage' &&
                          choice.state === 'available'
                        }
                      >
                        <CaretRightIcon class="size-4 shrink-0 text-ink-muted" />
                      </Show>
                    </Dropdown.Item>
                  )}
                </PipelineChoices>
              </Dropdown.Group>
            }
          >
            {(pipeline) => (
              <Dropdown.Group>
                <Dropdown.Item
                  closeOnSelect={false}
                  aria-label={t('crm.addToPipelineBack')}
                  onSelect={() => setStagesOf(undefined)}
                >
                  <CaretLeftIcon class="size-4 shrink-0" />
                  <span class="truncate">{pipeline().name}</span>
                </Dropdown.Item>
                <Dropdown.GroupLabel>
                  {t('crm.chooseStage')}
                </Dropdown.GroupLabel>
                <StageItems
                  controller={props.controller}
                  pipeline={pipeline()}
                />
              </Dropdown.Group>
            )}
          </Show>
        </Dropdown.Content>
      </Dropdown>
      <AddToPipelineFormHost controller={props.controller} />
    </>
  );
}
