import DownloadIcon from '@icon/system/regular/download-simple.svg?component-solid';
import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';

import { SettingsButton as Button } from '../primitives';
import { SignatureWorkspace } from './signature-workspace';

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
    // A row of the Signatures card on desktop, divided like the card's other
    // lists; touch keeps its boxed signatures.
    <div class="@container/signature flex flex-col gap-4 touch:rounded-2xl touch:border touch:border-edge-muted touch:p-4 not-touch:not-first:border-t not-touch:not-first:border-edge-divider not-touch:not-first:pt-4 not-touch:not-last:pb-2">
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
              disabled={props.pending || props.importing}
              onClick={() => onImport()()}
            >
              <DownloadIcon class="size-4" />
              {props.importing ? 'Importing…' : 'Import from Gmail'}
            </Button>
          )}
        </Show>
      </div>
      <SignatureWorkspace
        email={props.email}
        value={props.value}
        disabled={props.pending || !!props.importing}
        onInput={props.onInput}
        onReady={props.onReady}
        mobile={props.mobile}
      />
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
            variant="secondary"
            size="md"
            disabled={!props.hasContent || props.pending || props.importing}
            onClick={props.onClear}
          >
            Clear signature
          </Button>
          <Show when={!props.mobile}>
            <Button
              variant="primary"
              size="md"
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
    </div>
  );
}
