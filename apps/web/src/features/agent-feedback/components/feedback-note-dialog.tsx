/**
 * The optional note after a rating, and the way back to it later. Skip keeps
 * the rating without a note; Save sends the rating with the note.
 */
import { t } from '@app/lib/i18n';
import { ActionDialogShell, Button, Dialog, TextField } from '@ui';
import { createSignal } from 'solid-js';
import { FEEDBACK_NOTE_MAX_LENGTH, type FeedbackRating } from '../core/subject';

export function FeedbackNoteDialog(props: {
  open: boolean;
  rating: FeedbackRating;
  initialNote: string;
  onSave: (note: string) => void;
  onSkip: () => void;
}) {
  const [note, setNote] = createSignal(props.initialNote);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onSkip();
      }}
      position="center"
      class="w-110"
      visibleScrim
    >
      <ActionDialogShell>
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {props.rating === 'up'
                ? t('agentFeedback.noteTitleGood')
                : t('agentFeedback.noteTitleBad')}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {t('agentFeedback.noteDescription')}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <TextField value={note()} onChange={setNote}>
            <TextField.TextArea
              autoResize
              maxLength={FEEDBACK_NOTE_MAX_LENGTH}
              aria-label={t('agentFeedback.notePlaceholder')}
              placeholder={t('agentFeedback.notePlaceholder')}
            />
          </TextField>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button type="button" variant="ghost" onClick={() => props.onSkip()}>
            {t('agentFeedback.skip')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => props.onSave(note())}
          >
            {t('agentFeedback.save')}
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
