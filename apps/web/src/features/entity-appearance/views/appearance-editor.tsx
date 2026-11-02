import { MobileDrawer } from '@app/components/app/mobile/MobileDrawer';
import { t } from '@app/lib/i18n';
import { getEntityIconType } from '@core/component/EntityIcon';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { Popover } from '@kobalte/core/popover';
import type { ManagedDialogProps } from '@ui/components/ImperativeDialog';
import type { Result } from 'neverthrow';
import { createEffect, Show } from 'solid-js';
import type { EntityData } from '../../entity/types/entity';
import { AppearancePicker } from '../components/appearance-picker';
import type { EntityAppearance } from '../core/appearance';
import { createAppearanceEditor } from '../primitives/create-appearance-editor';
import { createRecentIcons } from '../primitives/create-recent-icons';

export type AppearanceEditorProps = ManagedDialogProps & {
  entity: EntityData;
  userId: string;
  anchor?: { x: number; y: number; width: number; height: number };
  isCurrent: () => boolean;
  save: (appearance: EntityAppearance) => Promise<Result<void, string>>;
};
export function AppearanceEditor(props: AppearanceEditorProps) {
  let anchor: HTMLSpanElement | undefined;
  const close = () => props.onOpenChange(false);
  const editor = createAppearanceEditor({
    initial: props.entity.appearance,
    isCurrent: props.isCurrent,
    save: props.save,
  });
  const recent = createRecentIcons(props.userId);
  createEffect(() => {
    if (!props.isCurrent()) close();
  });
  const content = () => (
    <AppearancePicker
      appearance={editor.appearance()}
      mobile={isMobile()}
      defaultIcon={getEntityIconType(props.entity)}
      onChange={(appearance) =>
        fireAndForget(editor.change(appearance), 'entity-appearance')
      }
      saving={editor.saving()}
      error={editor.error()}
      recent={recent.icons()}
      onPick={recent.record}
      onClose={close}
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
              left: `${props.anchor?.x ?? window.innerWidth / 2 - 172}px`,
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
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content
            targetHeight={Math.min(90, (560 / window.innerHeight) * 100)}
            maxHeight={95}
          >
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="sr-only">
              {t('appearance.title')}
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody class="overflow-hidden">
              {content()}
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
