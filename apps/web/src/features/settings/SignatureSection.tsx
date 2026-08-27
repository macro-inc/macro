import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { ThrownResultError } from '@core/util/result';
import SignatureIcon from '@phosphor-icons/core/regular/signature.svg?component-solid';
import { useEmailSignature } from '@queries/email/link';
import { useUpdateEmailSettingsMutation } from '@queries/email/settings';
import { SIGNATURE_IMAGES_UNRESOLVED_CODE } from '@service-email/client';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, lazy, Show, Suspense } from 'solid-js';

// Quill (and its CSS) is heavy and only needed once a signature section is
// expanded, so load it as its own chunk on demand instead of in the settings
// bundle.
const SignatureEditor = lazy(() => import('./SignatureEditor'));

// Unsaved signature drafts and per-inbox expanded state, keyed by link id and
// held at module scope. The settings panel unmounts the Connected Accounts tab
// when you switch away (and the links query can recreate an inbox row on
// refetch); keeping this outside that subtree means tabbing away and back no
// longer closes the editor or discards unsaved edits.
const [signatureDrafts, setSignatureDrafts] = createSignal<
  Record<string, string>
>({});
const [signatureExpanded, setSignatureExpanded] = createSignal<
  Record<string, boolean>
>({});

/** Whether an inbox's signature editor is expanded (reactive). */
export function isSignatureExpanded(linkId: string): boolean {
  return signatureExpanded()[linkId] ?? false;
}

/** Toggles an inbox's signature editor open/closed. */
export function toggleSignatureExpanded(linkId: string): void {
  setSignatureExpanded((prev) => ({
    ...prev,
    [linkId]: !isSignatureExpanded(linkId),
  }));
}

/**
 * Drops a link's draft + expanded entries so the module store doesn't retain
 * state for an inbox that no longer exists (called when an inbox is removed).
 */
export function clearSignatureState(linkId: string): void {
  setSignatureDrafts((prev) => {
    const next = { ...prev };
    delete next[linkId];
    return next;
  });
  setSignatureExpanded((prev) => {
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

  return 'Unable to save images. Use the image button to add images.';
}

/**
 * Per-inbox signature editor. Reads the persisted signature from the links
 * query (no extra fetch) into the Quill editor, tracks an unsaved draft, and
 * patches `email_settings` on save. The "replies & forwards" toggle patches
 * immediately (the backend patch is partial, so it leaves the signature alone).
 */
export function SignatureSection(props: { link: EmailLink }) {
  const signature = useEmailSignature(() => props.link.id);
  // Draft lives in the module-level store (keyed by link id) so it survives the
  // settings tab unmounting; `null` means "no unsaved edit".
  const draft = () => signatureDrafts()[props.link.id] ?? null;
  const setDraft = (html: string | null) =>
    setSignatureDrafts((prev) => {
      if (html === null) {
        const next = { ...prev };
        delete next[props.link.id];
        return next;
      }
      return { ...prev, [props.link.id]: html };
    });

  const persisted = () => signature() ?? '';
  const isDirty = () => draft() !== null && draft() !== persisted();
  // Enabled when there's a saved signature or unsaved draft text to clear — so
  // "Remove" stays available even after the user manually empties the editor.
  const hasContent = () => persisted().length > 0 || (draft()?.length ?? 0) > 0;

  const updateSettings = useUpdateEmailSettingsMutation();
  // Imperative handle to the editor, so Save/Remove sync its content directly
  // (the reactive `value` path alone didn't reliably clear the box on Remove).
  let editorApi: { setContent: (html: string) => void } | undefined;

  // Save failure shown inline below the buttons rather than as a toast — the
  // "images couldn't be loaded, re-add them" message is too long for a toast.
  // Cleared when the user edits, starts a new save, or removes the signature.
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const saveSignature = () => {
    const next = draft();
    if (next === null) return;
    setSaveError(null);
    updateSettings.mutate(
      { linkId: props.link.id, settings: { signature: next } },
      {
        onSuccess: (data) => {
          setDraft(null);
          editorApi?.setContent(data.settings.signature ?? '');
          toast.success('Signature saved');
        },
        // The backend rejects the whole patch (HTTP 422, nothing persisted) when
        // a signature has images that won't render for recipients — e.g. pasted
        // from another webmail account, so reachable only by that session. Show
        // the (long) message inline below the buttons and keep the draft so the
        // user can re-add those images and retry.
        onError: (error) => setSaveError(saveSignatureErrorMessage(error)),
      }
    );
  };

  // Clears the stored signature. Sending an empty string is the backend's
  // "clear" contract; the editor reseeds to empty once the cache updates.
  const removeSignature = () => {
    setSaveError(null);
    updateSettings.mutate(
      { linkId: props.link.id, settings: { signature: '' } },
      {
        onSuccess: () => {
          setDraft(null);
          editorApi?.setContent('');
          toast.success('Signature removed');
        },
        onError: () =>
          toast.failure('Failed to remove signature. Please try again.'),
      }
    );
  };

  const setOnRepliesForwards = (checked: boolean) => {
    updateSettings.mutate(
      {
        linkId: props.link.id,
        settings: { signature_on_replies_forwards: checked },
      },
      { onError: () => toast.failure('Failed to update setting.') }
    );
  };

  return (
    <div class="flex flex-col gap-3 rounded-xl border border-edge-muted p-3">
      {/* Editing (Quill) is desktop-only; on mobile the section still offers
          the replies/forwards toggle and Remove, with a pointer to desktop. */}
      <Show
        when={!isMobile()}
        fallback={
          <div class="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-edge-muted px-3 py-6 text-center">
            <SignatureIcon class="size-5 text-ink-muted" />
            <p class="text-sm text-ink-muted">
              Update your signature on desktop.
            </p>
          </div>
        }
      >
        <Suspense
          fallback={
            <div class="h-44 animate-pulse rounded-lg border border-edge-muted" />
          }
        >
          <SignatureEditor
            value={draft() ?? persisted()}
            onInput={(html) => {
              setDraft(html);
              setSaveError(null);
            }}
            onReady={(api) => {
              editorApi = api;
            }}
          />
        </Suspense>
      </Show>
      {/* Stacks on narrow screens so the toggle label and buttons never
          crowd each other onto wrapped lines. */}
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleSwitch
          checked={props.link.settings.signature_on_replies_forwards ?? false}
          onChange={setOnRepliesForwards}
          label={
            <span class="text-sm text-ink-muted">
              Add to replies & forwards
            </span>
          }
        />
        <div class="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            depth={3}
            disabled={!hasContent() || updateSettings.isPending}
            onClick={removeSignature}
          >
            Remove
          </Button>
          <Show when={!isMobile()}>
            <Button
              variant="accent"
              size="sm"
              depth={3}
              disabled={!isDirty() || updateSettings.isPending}
              onClick={saveSignature}
            >
              Save
            </Button>
          </Show>
        </div>
      </div>
      <Show when={saveError()}>
        {(msg) => <p class="text-right text-sm text-failure-ink">{msg()}</p>}
      </Show>
    </div>
  );
}
