import { t } from '@app/lib/i18n';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';
import { ADD_TO_PIPELINE_FLOW } from '../core/add-to-pipeline';
import type { AddToPipelineController } from '../primitives/add-to-pipeline';
import {
  AddToPipelineFormHost,
  AddToPipelineTrigger,
  choiceDisabledReason,
  PipelineChoiceLabel,
  PipelineChoices,
  StageItems,
} from './shared/add-to-pipeline';

/** The desktop Add to pipeline menu: each pipeline opens a submenu of its stages. */
export function AddToPipelineMenu(props: {
  controller: AddToPipelineController;
}) {
  const recordType = () => props.controller.record().type;
  return (
    <>
      <Dropdown
        onOpenChange={(open) => {
          if (open) props.controller.load();
        }}
      >
        <AddToPipelineTrigger />
        <Dropdown.Content
          class="min-w-56 max-w-80"
          aria-label={t('crm.addToPipeline')}
        >
          <Dropdown.Group>
            <PipelineChoices
              controller={props.controller}
              recordType={recordType()}
            >
              {(choice) => (
                <Show
                  when={
                    !choiceDisabledReason(choice) &&
                    ADD_TO_PIPELINE_FLOW === 'stage'
                  }
                  fallback={
                    <Dropdown.Item
                      disabledReason={choiceDisabledReason(choice)}
                      onSelect={() =>
                        props.controller.openForm(choice.pipeline)
                      }
                    >
                      <PipelineChoiceLabel choice={choice} />
                    </Dropdown.Item>
                  }
                >
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger>
                      <PipelineChoiceLabel choice={choice} />
                      <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent class="min-w-44 max-w-72">
                      <Dropdown.Group>
                        <Dropdown.GroupLabel>
                          {t('crm.chooseStage')}
                        </Dropdown.GroupLabel>
                        <StageItems
                          controller={props.controller}
                          pipeline={choice.pipeline}
                        />
                      </Dropdown.Group>
                    </Dropdown.SubContent>
                  </Dropdown.Sub>
                </Show>
              )}
            </PipelineChoices>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <AddToPipelineFormHost controller={props.controller} />
    </>
  );
}
