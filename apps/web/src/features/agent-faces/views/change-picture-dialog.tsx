import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { AgentFace } from '@macro-inc/agent-faces';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import { FaceEditor } from '../components/face-editor';
import { FaceImage } from '../components/face-image';
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
  name: string;
  initials: string;
  /** The face to start from: its saved one, or the one drawn for it now. */
  face: AgentFace;
  /** Saves the picture; resolves false when the server refused it. */
  onSave: (picture: AgentPicture) => Promise<boolean>;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Panel
        depth={2}
        class="max-h-[85vh] w-[28rem] max-w-full rounded-xl text-ink"
      >
        <Show when={props.open}>
          <ChangePictureBody {...props} />
        </Show>
      </Panel>
    </Dialog>
  );
}

/** Mounted per opening, so each one starts from the saved face. */
function ChangePictureBody(props: Parameters<typeof ChangePictureDialog>[0]) {
  const draft = createFaceDraft(props.face);
  const [saving, setSaving] = createSignal(false);

  const save = async () => {
    if (saving()) return;
    setSaving(true);
    const picture = await uploadAgentPicture(draft);
    const saved = picture.isOk() && (await props.onSave(picture.value));
    setSaving(false);
    if (!saved) {
      toast.failure(t('agentFaces.saveFailed'));
      return;
    }
    props.onOpenChange(false);
  };

  return (
    <>
      <Panel.Header class="gap-2 px-3">
        <Dialog.Title as="span" class="m-0 flex-1 p-0 text-base font-medium">
          {t('agentFaces.pictureTitle', { name: props.name })}
        </Dialog.Title>
      </Panel.Header>
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
          <FaceEditor draft={draft} initials={props.initials} fullWidthTabs />
        </div>
      </Panel.Body>
      <Panel.Footer class="justify-end gap-2 px-4 py-3">
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
