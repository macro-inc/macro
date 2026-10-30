import { t } from '@app/lib/i18n';
import { getEntityIconType } from '@core/component/EntityIcon';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { Popover } from '@kobalte/core/popover';
import { Dialog } from '@ui/components/Dialog';
import type { ManagedDialogProps } from '@ui/components/ImperativeDialog';
import type { Result } from 'neverthrow';
import { createEffect, Show } from 'solid-js';
import type { EntityData } from '../../entity/types/entity';
import { AppearancePicker } from '../components/appearance-picker';
import type { EntityAppearance } from '../core/appearance';
import { createAppearanceDraft } from '../primitives/create-appearance-draft';

export type AppearanceEditorProps = ManagedDialogProps & {
  entity: EntityData;
  anchor?: { x: number; y: number; width: number; height: number };
  isCurrent: () => boolean;
  save: (appearance: EntityAppearance) => Promise<Result<void, string>>;
};
export function AppearanceEditor(props: AppearanceEditorProps) {
  let anchor: HTMLSpanElement | undefined;
  const close = () => props.onOpenChange(false);
  const draft = createAppearanceDraft({
    initial: props.entity.appearance,
    isCurrent: props.isCurrent,
    save: props.save,
    onSaved: close,
  });
  createEffect(() => {
    if (!props.isCurrent()) close();
  });
  const content = () => (
    <AppearancePicker
      appearance={draft.appearance()}
      columns={isMobile() ? 5 : 7}
      defaultIcon={getEntityIconType(props.entity)}
      onChange={draft.change}
      changed={draft.changed()}
      saving={draft.saving()}
      error={draft.error()}
      onCancel={close}
      onApply={() => fireAndForget(draft.apply(), 'entity-appearance')}
    />
  );
  return (
    <Show
      when={isMobile()}
      fallback={
        <>
          <span
            ref={anchor}
            aria-hidden="true"
            class="pointer-events-none fixed"
            style={{
              left: `${props.anchor?.x ?? window.innerWidth / 2 - 176}px`,
              top: `${props.anchor?.y ?? 80}px`,
              width: `${props.anchor?.width ?? 1}px`,
              height: `${props.anchor?.height ?? 1}px`,
            }}
          />
          <Popover
            open={props.open}
            onOpenChange={props.onOpenChange}
            anchorRef={() => anchor}
            placement="bottom-start"
            gutter={8}
            fitViewport
            modal
          >
            <Popover.Portal>
              <Popover.Content
                aria-label={t('appearance.title')}
                class="menu-surface z-modal max-h-[calc(100dvh-24px)] overflow-y-auto outline-none"
              >
                <Popover.Title class="sr-only">
                  {t('appearance.title')}
                </Popover.Title>
                {content()}
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        </>
      }
    >
      <Dialog open={props.open} onOpenChange={props.onOpenChange} class="w-88">
        <Dialog.Title class="sr-only">{t('appearance.title')}</Dialog.Title>
        {content()}
      </Dialog>
    </Show>
  );
}
