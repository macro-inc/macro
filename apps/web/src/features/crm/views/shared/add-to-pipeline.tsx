import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Dropdown } from '@ui';
import { createEffect, For, type JSX, on, Show } from 'solid-js';
import type { PipelineChoice } from '../../core/add-to-pipeline';
import { stageColumn } from '../../core/add-to-pipeline';
import type { PipelineRecordType, TrackedPipeline } from '../../core/pipeline';
import {
  type AddToPipelineController,
  type AddToPipelineForm,
  formStage,
} from '../../primitives/add-to-pipeline';
import { AddPipelineRecordDialog } from '../add-pipeline-record';

/** The header button, beside the record's visibility control. */
export function AddToPipelineTrigger() {
  return (
    <Dropdown.Trigger
      size="xs"
      finish="flat"
      class="shrink-0 gap-1 focus-visible:ring-2 focus-visible:ring-accent/20 touch:min-h-6 touch:min-w-11 touch:my-2.5 touch:before:absolute touch:before:-inset-x-px touch:before:top-1/2 touch:before:h-11 touch:before:-translate-y-1/2 touch:before:content-['']"
    >
      <PlusIcon class="size-3 mobile:size-4" />
      {/* Phones keep the row for the record's name. */}
      <span class="mobile:sr-only">{t('crm.addToPipeline')}</span>
    </Dropdown.Trigger>
  );
}

/** A pipeline's name, with a check and the record's stages when it is already in it. */
export function PipelineChoiceLabel(props: { choice: PipelineChoice }) {
  return (
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate">{props.choice.pipeline.name}</span>
        <Show when={props.choice.inPipeline}>
          <CheckIcon
            class="size-3.5 shrink-0 text-ink-muted"
            role="img"
            aria-label={t('crm.addToPipelineIn')}
          />
        </Show>
      </span>
      <Show when={props.choice.stages.length}>
        <span class="truncate text-xs text-ink-muted">
          {t('crm.addToPipelineInStages', {
            stages: props.choice.stages.join(', '),
          })}
        </span>
      </Show>
    </span>
  );
}

/** Why a pipeline cannot take the record, shown on its disabled row. */
export function choiceDisabledReason(
  choice: PipelineChoice
): string | undefined {
  if (choice.state === 'view-only') return t('crm.addToPipelineReadOnly');
  if (choice.state === 'already-in')
    return t('crm.addToPipelineContactAlreadyIn');
  return undefined;
}

/**
 * The menu's pipelines, or what stands in for them: a skeleton while they
 * load, a retry when they fail, and a line saying the team has none.
 */
export function PipelineChoices(props: {
  controller: AddToPipelineController;
  recordType: PipelineRecordType;
  children: (choice: PipelineChoice) => JSX.Element;
}) {
  return (
    <Show
      when={(() => {
        const state = props.controller.state();
        return state.kind === 'ready' ? state.choices : undefined;
      })()}
      fallback={
        <MenuStatus
          controller={props.controller}
          recordType={props.recordType}
        />
      }
    >
      {(choices) => <For each={choices()}>{props.children}</For>}
    </Show>
  );
}

function MenuStatus(props: {
  controller: AddToPipelineController;
  recordType: PipelineRecordType;
}) {
  const kind = () => props.controller.state().kind;
  return (
    <>
      <Show when={kind() === 'loading'}>
        <div
          class="flex flex-col gap-2 px-2 py-1.5"
          role="status"
          aria-label={t('crm.loadingPipelines')}
        >
          <ListSkeleton.Bar class="h-3 w-32" />
          <ListSkeleton.Bar class="h-3 w-24" />
        </div>
      </Show>
      <Show when={kind() === 'error'}>
        <Dropdown.Item
          closeOnSelect={false}
          onSelect={() =>
            fireAndForget(
              props.controller.source()?.retry() ?? Promise.resolve(),
              'crm'
            )
          }
        >
          <ArrowCounterClockwiseIcon class="size-4 shrink-0" />
          {t('crm.pipelinesLoadFailed')}
        </Dropdown.Item>
      </Show>
      <Show when={kind() === 'empty'}>
        <p class="px-2 py-1.5 text-sm text-ink-muted">
          {props.recordType === 'company'
            ? t('crm.addToPipelineNoCompanyPipelines')
            : t('crm.addToPipelineNoContactPipelines')}
        </p>
      </Show>
    </>
  );
}

/**
 * A pipeline's stages. Mounting this reads the pipeline's columns and stage
 * requirements, so it is mounted only while the stages are shown.
 */
export function StageItems(props: {
  controller: AddToPipelineController;
  pipeline: TrackedPipeline;
}) {
  const source = props.controller.source();
  if (!source) return null;
  const schema = source.createSchema(props.pipeline);
  const stages = () => {
    const columns = schema.columns();
    return columns && stageColumn(columns);
  };
  const choose = (stage: string | undefined) => {
    const columns = schema.columns();
    if (!columns) return;
    fireAndForget(
      props.controller.chooseStage(
        props.pipeline,
        columns,
        schema.requirements() ?? [],
        stage
      ),
      'crm'
    );
  };
  return (
    <Show
      when={schema.columns() && schema.requirements()}
      fallback={
        <Show
          when={schema.error()}
          fallback={
            <div
              class="flex flex-col gap-2 px-2 py-1.5"
              role="status"
              aria-label={t('crm.addToPipelineLoadingStages')}
            >
              <ListSkeleton.Bar class="h-3 w-24" />
              <ListSkeleton.Bar class="h-3 w-20" />
              <ListSkeleton.Bar class="h-3 w-28" />
            </div>
          }
        >
          <p class="px-2 py-1.5 text-sm text-ink-muted">
            {t('crm.addToPipelineStagesFailed')}
          </p>
        </Show>
      }
    >
      <Show
        when={stages()}
        fallback={
          <Dropdown.Item
            disabled={props.controller.adding()}
            onSelect={() => choose(undefined)}
          >
            {t('crm.addToPipelineNoStages', {
              pipeline: props.pipeline.name,
            })}
          </Dropdown.Item>
        }
      >
        {(column) => (
          <For each={column().options}>
            {(option) => (
              <Dropdown.Item
                disabled={props.controller.adding()}
                onSelect={() => choose(option.label)}
              >
                <span class="truncate">{option.label}</span>
              </Dropdown.Item>
            )}
          </For>
        )}
      </Show>
    </Show>
  );
}

/** The add form for the record, opened when its stage requires fields. */
export function AddToPipelineFormHost(props: {
  controller: AddToPipelineController;
}) {
  return (
    <Show when={props.controller.form()} keyed>
      {(form) => <PipelineForm controller={props.controller} form={form} />}
    </Show>
  );
}

function PipelineForm(props: {
  controller: AddToPipelineController;
  form: AddToPipelineForm;
}) {
  const source = props.controller.source();
  if (!source) return null;
  const schema = source.createSchema(props.form.pipeline);
  // The menu has closed, so a pipeline whose schema cannot be read says so here.
  createEffect(
    on(schema.error, (failed) => {
      if (!failed || schema.columns()) return;
      props.controller.failForm(props.form.pipeline);
    })
  );
  return (
    <Show when={schema.columns()}>
      {(columns) => (
        <AddPipelineRecordDialog
          {...source.cells}
          pipeline={props.form.pipeline}
          columns={columns()}
          requirements={schema.requirements()}
          requirementsLoading={schema.loading()}
          requirementsError={schema.error()}
          initialValues={formStage(columns(), props.form.stage)}
          record={props.controller.record()}
          onCreate={(creation) =>
            props.controller.addRow(props.form.pipeline, columns(), creation)
          }
          onClose={props.controller.closeForm}
        />
      )}
    </Show>
  );
}
