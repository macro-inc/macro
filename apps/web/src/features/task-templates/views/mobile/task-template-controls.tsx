import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FileIcon from '@icon/system/regular/file.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Button, useImperativeDialog } from '@ui';
import { Show } from 'solid-js';
import type { TaskComposerController } from '../../../task-composer/primitives/task-composer';
import {
  ScopedTemplatePicker,
  templateControlsScope,
  useTaskTemplateControls,
} from '../shared/task-template-controls';

/** Touch template controls; the picker sheet is scoped to the composer. */
export function MobileTaskTemplateControls(props: {
  composer: TaskComposerController;
  compact?: boolean;
}) {
  const viewerId = useUserId();
  return (
    <Show when={templateControlsScope(props.composer, viewerId)} keyed>
      {(_scope) => (
        <ScopedMobileTaskTemplateControls {...props} viewerId={viewerId} />
      )}
    </Show>
  );
}

function ScopedMobileTaskTemplateControls(props: {
  composer: TaskComposerController;
  compact?: boolean;
  viewerId: ReturnType<typeof useUserId>;
}) {
  const picker = useImperativeDialog(ScopedTemplatePicker);
  const { controls, pickerProps } = useTaskTemplateControls({
    composer: props.composer,
    viewerId: props.viewerId,
    isPickerOpen: picker.isOpen,
  });
  const openPicker = () => {
    if (controls.canUse())
      picker.open(() => ({ ...controls.scope, ...pickerProps() }));
  };
  return (
    <div class="min-w-0 flex-1 flex items-center justify-between gap-2">
      <Show
        when={props.composer.isTemplateMode()}
        fallback={
          <Button
            variant="secondary"
            size={props.compact ? 'icon-sm' : 'sm'}
            aria-label={t('create.taskTemplateSelected', {
              name: controls.selectedLabel(),
            })}
            disabled={!controls.canUse() || !props.composer.definitionsReady()}
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openPicker}
          >
            <Show
              when={controls.selectedKey() === 'none'}
              fallback={<CopyIcon class="size-4 shrink-0" />}
            >
              <FileIcon class="size-4 shrink-0" />
            </Show>
            <Show when={!props.compact}>{controls.selectedLabel()}</Show>
            <Show when={props.composer.areTemplateFieldsDirty()}>
              <span class="size-1.5 shrink-0 rounded-full bg-accent" />
            </Show>
          </Button>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          class="shrink-0 gap-1"
          disabled={props.composer.isSavingTemplate()}
          onClick={props.composer.cancelTemplateEdit}
        >
          <CaretLeftIcon class="size-4 shrink-0" />
          {props.composer.templateSelection().kind === 'new'
            ? t('create.taskTemplateNew')
            : t('create.taskTemplateEdit')}
        </Button>
        <Show
          when={
            props.composer.templateSelection().kind === 'editing' &&
            controls.selectedCanManage()
          }
        >
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={t('create.taskTemplateDelete')}
            tooltip={t('create.taskTemplateDelete')}
            disabled={props.composer.isSavingTemplate()}
            onClick={controls.remove}
          >
            <TrashIcon class="size-4 shrink-0" />
          </Button>
        </Show>
      </Show>
    </div>
  );
}
