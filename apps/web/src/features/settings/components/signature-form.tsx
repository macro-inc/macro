import DownloadIcon from '@phosphor-icons/core/regular/download-simple.svg?component-solid';
import SignatureIcon from '@phosphor-icons/core/regular/signature.svg?component-solid';
import { ToggleSwitch } from '@ui';
import { lazy, Show, Suspense } from 'solid-js';

import { SettingsButton as Button, SettingsSurface } from '../primitives';

const SignatureEditor = lazy(() => import('../SignatureEditor'));

export function SignatureForm(props: {
  email: string;
  value: string;
  onInput: (html: string) => void;
  onReady: (api: { setContent: (html: string) => void }) => void;
  onSave: () => void;
  onClear: () => void;
  /** Replaces the signature with the one set in Gmail. Omit to hide. */
  onImport?: () => void;
  importing?: boolean;
  dirty: boolean;
  hasContent: boolean;
  pending: boolean;
  replies: boolean;
  onRepliesChange: (checked: boolean) => void;
  error?: string | null;
  mobile: boolean;
}) {
  return (
    <SettingsSurface class="@container/signature flex flex-col gap-4 rounded-2xl border border-edge-muted p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-medium break-all">{props.email}</h3>
          <p class="mt-1 text-sm text-ink-muted">
            Automatically added to new emails from this account.
          </p>
        </div>
        <Show when={!props.mobile && props.onImport}>
          {(onImport) => (
            <Button
              class="shrink-0"
              variant="ghost"
              size="md"
              depth={3}
              disabled={props.pending || props.importing}
              onClick={() => onImport()()}
            >
              <DownloadIcon class="size-4" />
              {props.importing ? 'Importing…' : 'Import from Gmail'}
            </Button>
          )}
        </Show>
      </div>
      {/* Editing (Quill) is desktop-only; on mobile the section still offers
          the replies/forwards toggle and Remove, with a pointer to desktop. */}
      <Show
        when={!props.mobile}
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
            <div class="h-44 animate-pulse rounded-lg border-1 border-ink/10" />
          }
        >
          <SignatureEditor
            label={`Signature for ${props.email}`}
            value={props.value}
            disabled={props.pending || props.importing}
            onInput={props.onInput}
            onReady={props.onReady}
          />
        </Suspense>
      </Show>
      {/* Stacks on narrow screens so the toggle label and buttons never
          crowd each other onto wrapped lines. */}
      <div class="flex flex-col gap-3 @[520px]/signature:flex-row @[520px]/signature:items-center @[520px]/signature:justify-between">
        <ToggleSwitch
          checked={props.replies}
          onChange={props.onRepliesChange}
          disabled={props.pending}
          label={
            <span class="text-sm text-ink-muted">
              Add to replies & forwards
            </span>
          }
        />
        <div class="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="md"
            depth={3}
            disabled={!props.hasContent || props.pending || props.importing}
            onClick={props.onClear}
          >
            Clear signature
          </Button>
          <Show when={!props.mobile}>
            <Button
              variant="cta"
              size="md"
              depth={3}
              disabled={!props.dirty || props.pending || props.importing}
              onClick={props.onSave}
            >
              {props.pending ? 'Saving…' : 'Save signature'}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={props.error}>
        {(msg) => <p class="text-right text-sm text-failure-ink">{msg()}</p>}
      </Show>
    </SettingsSurface>
  );
}
