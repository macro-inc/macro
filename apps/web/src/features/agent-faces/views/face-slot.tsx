import { t } from '@app/lib/i18n';
import { Popover } from '@kobalte/core/popover';
import { createSignal, Show } from 'solid-js';
import { FaceEditor } from '../components/face-editor';
import { FaceImage } from '../components/face-image';
import { ShuffleBadge } from '../components/shuffle-badge';
import type { FaceSlotProps } from './shared/face-slot-props';

/** Desktop: the face opens its parts in a popover beside it. */
export function DesktopFaceSlot(props: FaceSlotProps) {
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  return (
    <span class="relative flex shrink-0" data-face-slot>
      <Popover placement="bottom-start" gutter={8}>
        <Popover.Trigger
          ref={setTrigger}
          aria-label={t('agentFaces.editFace')}
          class="rounded-full"
        >
          <FaceImage
            face={props.draft.face()}
            photoUrl={props.draft.photo()?.url}
            size={props.size}
            initials={props.initials}
          />
        </Popover.Trigger>
        <Popover.Portal
          mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
        >
          <Popover.Content class="menu-surface z-action-menu w-88 max-w-[calc(100vw-1rem)] max-h-[min(32rem,var(--kb-popper-content-available-height,32rem))] overflow-y-auto rounded-xl p-3 text-ink outline-none">
            <Popover.Title class="sr-only">
              {t('agentFaces.sheetTitle')}
            </Popover.Title>
            <FaceEditor draft={props.draft} initials={props.initials} />
          </Popover.Content>
        </Popover.Portal>
      </Popover>
      <Show when={!props.draft.photo()}>
        <ShuffleBadge onShuffle={props.draft.shuffle} />
      </Show>
    </span>
  );
}
