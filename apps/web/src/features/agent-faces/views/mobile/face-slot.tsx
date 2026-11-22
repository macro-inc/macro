import { t } from '@app/lib/i18n';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import { FaceEditor } from '../../components/face-editor';
import { FaceImage } from '../../components/face-image';
import { ShuffleBadge } from '../../components/shuffle-badge';
import type { FaceSlotProps } from '../shared/face-slot-props';

/** Touch: the face opens its parts in a sheet stacked over the form. */
export function MobileFaceSlot(props: FaceSlotProps) {
  const [open, setOpen] = createSignal(false);
  return (
    <span class="relative flex shrink-0" data-face-slot>
      <button
        type="button"
        aria-label={t('agentFaces.editFace')}
        class="rounded-full"
        onClick={() => setOpen(true)}
      >
        <FaceImage
          face={props.draft.face()}
          photoUrl={props.draft.photo()?.url}
          size={props.size}
          initials={props.initials}
        />
      </button>
      <Show when={!props.draft.photo()}>
        <ShuffleBadge onShuffle={props.draft.shuffle} />
      </Show>
      {/* Stacked over the invite sheet, so glass would show its controls. */}
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        opaqueSheet
        class="w-[28rem]"
      >
        <Panel depth={2} class="max-h-[85vh] w-full rounded-xl text-ink">
          {/* The title takes the body's inset; Done's own padding lines its
              text up on the other edge. */}
          <Panel.Header class="justify-between gap-2 pr-3 pl-5">
            <Dialog.Title as="span" class="m-0 p-0 text-base font-medium">
              {t('agentFaces.sheetTitle')}
            </Dialog.Title>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t('agentFaces.done')}
            </Button>
          </Panel.Header>
          <Panel.Body scroll>
            <div class="flex flex-col gap-4 px-5 py-5">
              <Show when={!props.draft.photo()}>
                <span class="self-center">
                  <FaceImage
                    face={props.draft.face()}
                    size={96}
                    initials={props.initials}
                  />
                </span>
              </Show>
              <FaceEditor
                draft={props.draft}
                initials={props.initials}
                fullWidthTabs
              />
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </span>
  );
}
