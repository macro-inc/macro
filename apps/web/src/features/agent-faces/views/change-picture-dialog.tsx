import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import type { AgentFace } from '@macro-inc/agent-faces';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import { FaceEditor } from '../components/face-editor';
import { FaceImage } from '../components/face-image';
import { FACE_TABS, partsOfTab } from '../core/face-tabs';
import { createFaceDraft } from '../primitives/create-face-draft';
import {
  type AgentPicture,
  uploadAgentPicture,
} from '../primitives/upload-agent-picture';

/**
 * Change an added agent's picture: its face's parts, a shuffle, or a photo,
 * saved only on Save. A phone gets it as a sheet.
 */
export function ChangePictureDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  name: string;
  initials: string;
  /** The face to start from: its saved one, or the one drawn for it now. */
  face: AgentFace;
  /** An existing photo is kept until another picture is chosen. */
  photoUrl?: string;
  /** The account/team owning this opening is still active. */
  isCurrent?: () => boolean;
  pictureState?: 'loading' | 'error' | 'ready';
  onRetryPicture?: () => void;
  /** Saves the picture; resolves false when the server refused it. */
  onSave: (picture: AgentPicture) => Promise<boolean>;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      onCloseAutoFocus={props.onCloseAutoFocus}
      // Sized to the editor, not the dialog's default width.
      class="w-[28rem]"
    >
      <Panel depth={2} class="max-h-[85vh] w-full rounded-xl text-ink">
        {/* A phone sheet has no close button, so its title takes the body's
            inset. */}
        <Panel.Header class="gap-2 px-3 mobile:px-5">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.close')}
          >
            <XIcon class="pointer-events-none size-4 shrink-0 touch:size-6" />
          </Dialog.CloseButton>
          <Dialog.Title
            as="span"
            class="m-0 flex-1 truncate p-0 text-base font-medium"
          >
            {t('agentFaces.pictureTitle', { name: props.name })}
          </Dialog.Title>
        </Panel.Header>
        <Show when={props.open}>
          <Switch fallback={<ChangePictureBody {...props} />}>
            <Match when={props.pictureState === 'loading'}>
              <ChangePictureSkeleton
                onCancel={() => props.onOpenChange(false)}
              />
            </Match>
            <Match when={props.pictureState === 'error'}>
              <Panel.Body>
                <div class="flex flex-col items-start gap-3 px-5 py-5">
                  <p role="alert" class="text-sm text-ink-muted">
                    {t('agentFaces.loadFailed')}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={props.onRetryPicture}
                  >
                    {t('agentFaces.retry')}
                  </Button>
                </div>
              </Panel.Body>
            </Match>
          </Switch>
        </Show>
      </Panel>
    </Dialog>
  );
}

/**
 * The editor's outline while the saved picture loads, as tall as the editor
 * and with its footer, so the dialog doesn't grow when the picture arrives.
 */
function ChangePictureSkeleton(props: { onCancel: () => void }) {
  return (
    <>
      <Panel.Body>
        <ListSkeleton.Root label={t('agentFaces.loading')} class="px-5 py-5">
          <div class="flex flex-col gap-4">
            <ListSkeleton.Bar class="size-24 self-center" />
            <div class="flex flex-col gap-3">
              <div class="flex h-8 items-center">
                <ListSkeleton.Bar class="w-12" />
              </div>
              <div class="grid grid-cols-[repeat(8,auto)] justify-between gap-y-2 max-sm:grid-cols-[repeat(4,auto)] max-sm:gap-y-4">
                <For each={Array.from({ length: 8 })}>
                  {() => <ListSkeleton.Bar class="size-9 touch:size-12" />}
                </For>
              </div>
              <ListSkeleton.Bar class="h-8 w-full" />
              {/* The first tab's rows, each Any then its options, on the
                  editor's wrapping rows and touch-sized hit areas, so they
                  wrap where the editor's do. */}
              <For each={partsOfTab(FACE_TABS[0])}>
                {(row) => (
                  <div class="flex flex-col gap-1.5">
                    <ListSkeleton.Bar class="w-10" />
                    <div class="flex flex-wrap gap-1.5 touch:gap-y-2">
                      <span class="flex items-center touch:min-h-[44px]">
                        <ListSkeleton.Bar class="h-6 w-11" />
                      </span>
                      <For each={Array.from({ length: row.options })}>
                        {() => (
                          <span class="flex items-center justify-center touch:size-11">
                            <ListSkeleton.Bar class="size-8" />
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
              {/* Upload photo and Reset. */}
              <div class="h-8 touch:h-11" />
            </div>
          </div>
        </ListSkeleton.Root>
      </Panel.Body>
      <Panel.Footer class="justify-end gap-2 px-5 py-3">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          {t('agentFaces.cancel')}
        </Button>
        <Button type="button" variant="primary" disabled>
          {t('agentFaces.save')}
        </Button>
      </Panel.Footer>
    </>
  );
}

/** Mounted per opening, so each one starts from the saved face. */
function ChangePictureBody(props: Parameters<typeof ChangePictureDialog>[0]) {
  const draft = createFaceDraft(props.face, props.photoUrl);
  const [saving, setSaving] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const active = () => !disposed && (props.isCurrent?.() ?? true);

  const save = async () => {
    if (saving() || !active()) return;
    setSaving(true);
    const picture = await uploadAgentPicture(draft);
    if (!active()) return;
    const saved = picture.isOk() && (await props.onSave(picture.value));
    if (!active()) return;
    setSaving(false);
    if (!saved) {
      toast.failure(t('agentFaces.saveFailed'));
      return;
    }
    props.onOpenChange(false);
  };

  return (
    <>
      <Panel.Body scroll>
        <div class="flex flex-col gap-4 px-5 py-5">
          <Show when={!draft.photo()}>
            <span class="self-center">
              <FaceImage
                face={draft.face()}
                size={96}
                initials={props.initials}
              />
            </span>
          </Show>
          <fieldset disabled={saving()} class="contents">
            <FaceEditor draft={draft} initials={props.initials} fullWidthTabs />
          </fieldset>
        </div>
      </Panel.Body>
      <Panel.Footer class="justify-end gap-2 px-5 py-3">
        <Button
          type="button"
          variant="ghost"
          disabled={saving()}
          onClick={() => props.onOpenChange(false)}
        >
          {t('agentFaces.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          aria-disabled={saving() || undefined}
          aria-busy={saving() || undefined}
          data-disabled={saving() ? '' : undefined}
          onClick={() => fireAndForget(save(), 'agent-face.save')}
        >
          {t('agentFaces.save')}
        </Button>
      </Panel.Footer>
    </>
  );
}
