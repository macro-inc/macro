import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { TaskComposerController } from '../../task-composer/primitives/task-composer';
import { TemplateDropdown } from '../components/template-picker';
import {
  templateControlsScope,
  useTaskTemplateControls,
} from './shared/task-template-controls';

export { TaskTemplateNameStrip } from './shared/task-template-name-strip';

/** Desktop template controls; the composer owns the selected template. */
export function TaskTemplateControls(props: {
  composer: TaskComposerController;
}) {
  const viewerId = useUserId();
  return (
    <Show when={templateControlsScope(props.composer, viewerId)} keyed>
      {(_scope) => (
        <ScopedTaskTemplateControls
          composer={props.composer}
          viewerId={viewerId}
        />
      )}
    </Show>
  );
}

function ScopedTaskTemplateControls(props: {
  composer: TaskComposerController;
  viewerId: ReturnType<typeof useUserId>;
}) {
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  const { controls, pickerProps } = useTaskTemplateControls({
    ...props,
    isPickerOpen: dropdownOpen,
  });
  const changeDropdownOpen = (open: boolean) => {
    if (open && !controls.canUse()) return;
    setDropdownOpen(open);
  };
  return (
    <div class="min-w-0 flex-1 flex items-center justify-between gap-2">
      <Show
        when={props.composer.isTemplateMode()}
        fallback={
          <TemplateDropdown
            {...pickerProps()}
            open={dropdownOpen()}
            onOpenChange={changeDropdownOpen}
            disabled={!controls.canUse() || !props.composer.definitionsReady()}
          />
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
            size="xs"
            aria-label={t('create.taskTemplateDelete')}
            tooltip={t('create.taskTemplateDelete')}
            disabled={props.composer.isSavingTemplate()}
            onClick={controls.remove}
          >
            {t('create.taskTemplateDelete')}
          </Button>
        </Show>
      </Show>
    </div>
  );
}
