import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { useEmailSignature } from '@queries/email/link';
import {
  traceSignatureMutation,
  useImportGmailSignatureMutation,
  useUpdateEmailSettingsMutation,
} from '@queries/email/settings';
import { SIGNATURE_IMAGES_UNRESOLVED_CODE } from '@service-email/client';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { createSignal } from 'solid-js';
import { SignatureForm } from './components/signature-form';

// Keep drafts when navigating away from Email settings. Quill loads on demand.
const [signatureDrafts, setSignatureDrafts] = createSignal<
  Record<string, { html: string }>
>({});
export function clearSignatureState(linkId: string): void {
  setSignatureDrafts((prev) => {
    const next = { ...prev };
    delete next[linkId];
    return next;
  });
}

/**
 * Picks the inline error message for a failed signature save. The backend
 * rejects the whole patch with a `SIGNATURE_IMAGES_UNRESOLVED` error when images
 * can't be loaded; everything else is a generic failure.
 */
function saveSignatureErrorMessage(error: Error): string {
  const unresolved =
    error instanceof ThrownResultError
      ? error.errors.find((e) => e.code === SIGNATURE_IMAGES_UNRESOLVED_CODE)
      : undefined;
  if (!unresolved) return 'Failed to save signature. Please try again.';

  return 'Unable to save images. Add accessible image URLs in HTML, or use the image button in Rich text.';
}

/**
 * Per-inbox signature editor. Reads the persisted signature from the links
 * query (no extra fetch) into an HTML preview, tracks an unsaved draft, and
 * patches `email_settings` on save. The "replies & forwards" toggle patches
 * immediately (the backend patch is partial, so it leaves the signature alone).
 */
export function SignatureSection(props: { link: EmailLink }) {
  const signature = useEmailSignature(() => props.link.id);
  // Draft lives in the module-level store (keyed by link id) so it survives the
  // settings tab unmounting; `null` means "no unsaved edit".
  const draft = () => signatureDrafts()[props.link.id]?.html ?? null;
  // A fresh snapshot distinguishes a new edit even when its HTML is identical.
  const setDraft = (html: string) =>
    setSignatureDrafts((prev) => ({ ...prev, [props.link.id]: { html } }));

  const persisted = () => signature() ?? '';
  const isDirty = () => draft() !== null && draft() !== persisted();
  // Enabled when there's a saved signature or unsaved draft text to clear — so
  // "Remove" stays available even after the user manually empties the editor.
  const hasContent = () => persisted().length > 0 || (draft()?.length ?? 0) > 0;

  // Imperative handle to the editor, so Save/Remove sync its content directly
  // (the reactive `value` path alone didn't reliably clear the box on Remove).
  let editorApi: { setContent: (html: string) => void } | undefined;

  // Save failure shown inline below the buttons rather than as a toast — the
  // "images couldn't be loaded, re-add them" message is too long for a toast.
  // Cleared when the user edits, starts a new save, or removes the signature.
  const [saveError, setSaveError] = createSignal<string | null>(null);

  // Updating the links cache can remount this row. Hook callbacks still run
  // after that; callbacks passed to mutate would leave the old draft behind.
  const updateSettings = useUpdateEmailSettingsMutation({
    onMutate: () => signatureDrafts()[props.link.id],
    onSuccess: (data, { linkId, settings }, submittedDraft) => {
      if (settings.signature === undefined) return;
      // A user may reopen settings and start another draft while this finishes.
      if (signatureDrafts()[linkId] === submittedDraft) {
        clearSignatureState(linkId);
        editorApi?.setContent(data.settings.signature ?? '');
      }
      toast.success(
        settings.signature ? 'Signature saved' : 'Signature removed'
      );
    },
    onError: (error, { settings }) => {
      if (settings.signature === undefined) {
        toast.failure('Failed to update setting.');
      } else if (settings.signature === '') {
        toast.failure('Failed to remove signature. Please try again.');
      } else {
        setSaveError(saveSignatureErrorMessage(error));
      }
    },
  });

  const importGmailSignature = useImportGmailSignatureMutation({
    onMutate: () => signatureDrafts()[props.link.id],
    onSuccess: (result, { linkId }, submittedDraft) => {
      if (result.success) {
        if (signatureDrafts()[linkId] === submittedDraft) {
          clearSignatureState(linkId);
          editorApi?.setContent(result.settings.signature ?? '');
        }
        toast.success('Signature imported from Gmail');
      } else if (result.reason === 'no_signature') {
        toast.failure('No signature found in Gmail');
      } else if (result.reason === 'unresolved_images') {
        setSaveError(
          "Couldn't import images from your Gmail signature. Add accessible image URLs in HTML, or use the image button in Rich text."
        );
      } else {
        toast.failure('Failed to import signature. Please try again.');
      }
    },
    onError: () =>
      toast.failure('Failed to import signature. Please try again.'),
  });

  const saveSignature = () => {
    const next = draft();
    if (next === null) return;
    setSaveError(null);
    fireAndForget(
      traceSignatureMutation('save', props.link.id, (span) =>
        updateSettings.mutateAsync({
          span,
          linkId: props.link.id,
          settings: { signature: next },
        })
      ),
      'email-signature'
    );
  };

  // Clears the stored signature. Sending an empty string is the backend's
  // "clear" contract; the editor reseeds to empty once the cache updates.
  const removeSignature = () => {
    setSaveError(null);
    fireAndForget(
      traceSignatureMutation('clear', props.link.id, (span) =>
        updateSettings.mutateAsync({
          span,
          linkId: props.link.id,
          settings: { signature: '' },
        })
      ),
      'email-signature'
    );
  };

  // The backend fetches the Gmail signature and saves it, so on success the
  // editor shows the persisted value and any unsaved draft is discarded.
  const importFromGmail = () => {
    if (props.link.provider !== 'GMAIL') return;
    setSaveError(null);
    fireAndForget(
      traceSignatureMutation('import', props.link.id, (span) =>
        importGmailSignature.mutateAsync({ linkId: props.link.id, span })
      ),
      'email-signature'
    );
  };

  const setOnRepliesForwards = (checked: boolean) => {
    updateSettings.mutate({
      linkId: props.link.id,
      settings: { signature_on_replies_forwards: checked },
    });
  };

  return (
    <SignatureForm
      email={props.link.email_address}
      value={isMobile() ? persisted() : (draft() ?? persisted())}
      onInput={(html) => {
        setDraft(html);
        setSaveError(null);
      }}
      onReady={(api) => {
        editorApi = api;
      }}
      onSave={saveSignature}
      onClear={removeSignature}
      onImport={props.link.provider === 'GMAIL' ? importFromGmail : undefined}
      importing={importGmailSignature.isPending}
      dirty={isDirty()}
      hasContent={hasContent()}
      pending={updateSettings.isPending}
      replies={props.link.settings.signature_on_replies_forwards ?? false}
      onRepliesChange={setOnRepliesForwards}
      error={saveError()}
      mobile={isMobile()}
    />
  );
}
