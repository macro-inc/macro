import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { SignatureContent } from '@app/features/email-compose/components/signature-preview';
import { ConfirmDialog, TabSelector } from '@ui';
import { createSignal, lazy, onMount, Show, Suspense } from 'solid-js';
import { requiresHtmlEditing } from '../core/signature-html';

const SignatureEditor = lazy(() => import('../SignatureEditor'));

export function SignatureWorkspace(props: {
  email: string;
  value: string;
  onInput: (html: string) => void;
  onReady: (api: { setContent: (html: string) => void }) => void;
  disabled: boolean;
  mobile: boolean;
}) {
  const [view, setView] = createSignal('preview');
  const [confirmConversion, setConfirmConversion] = createSignal(false);
  const [pastedHtml, setPastedHtml] = createSignal<string>();
  let editorApi: { setContent: (html: string) => void } | undefined;

  onMount(() =>
    props.onReady({
      setContent: (html) => {
        editorApi?.setContent(html);
        setView('preview');
      },
    })
  );

  const changeView = (next: string) => {
    if (props.disabled) return;
    if (next === 'rich-text' && requiresHtmlEditing(props.value)) {
      setConfirmConversion(true);
      return;
    }
    setView(next);
  };

  const usePastedHtml = (html: string) => {
    props.onInput(html);
    setPastedHtml(undefined);
    setView('preview');
  };

  const preview = () => (
    <Show
      when={props.value.trim()}
      fallback={
        <p class="px-4 py-8 text-center text-sm text-ink-muted">
          {props.mobile
            ? 'No signature saved.'
            : 'Write in Rich text or paste your HTML.'}
        </p>
      }
    >
      <SignatureContent
        html={props.value}
        label={`Signature preview for ${props.email}`}
      />
    </Show>
  );

  return (
    <div class="min-w-0">
      <Show
        when={!props.mobile}
        fallback={
          <div class="flex min-w-0 flex-col gap-2">
            {preview()}
            <p class="text-sm text-ink-muted">
              Update your signature on desktop.
            </p>
          </div>
        }
      >
        <TabSelector.Root
          value={view()}
          onChange={changeView}
          class="flex min-w-0 flex-col gap-3"
        >
          <TabSelector>
            <TabSelector.List aria-label={`Signature views for ${props.email}`}>
              <TabSelector.Tab value="preview" disabled={props.disabled}>
                Preview
              </TabSelector.Tab>
              <TabSelector.Tab value="rich-text" disabled={props.disabled}>
                Rich text
              </TabSelector.Tab>
              <TabSelector.Tab value="html" disabled={props.disabled}>
                HTML
              </TabSelector.Tab>
            </TabSelector.List>
          </TabSelector>
          <TabSelector.Panel value="preview" class="min-w-0">
            {preview()}
          </TabSelector.Panel>
          <TabSelector.Panel value="rich-text">
            <Suspense
              fallback={<ListSkeleton.Bar class="h-44 w-full rounded-xl" />}
            >
              <SignatureEditor
                value={props.value}
                label={`Signature for ${props.email}`}
                disabled={props.disabled}
                onInput={props.onInput}
                onReady={(api) => {
                  editorApi = api;
                }}
                onPasteHtml={(html) => {
                  if (!requiresHtmlEditing(html)) return false;
                  if (props.value.trim()) setPastedHtml(html);
                  else usePastedHtml(html);
                  return true;
                }}
              />
            </Suspense>
          </TabSelector.Panel>
          <TabSelector.Panel value="html" class="flex flex-col gap-2">
            <p class="text-sm text-ink-muted">
              Paste or edit your signature’s HTML to keep its layout. Check
              Preview before saving.
            </p>
            <textarea
              class="settings-input ph-no-capture min-h-52 w-full resize-y py-3 font-mono text-xs"
              aria-label={`Signature HTML for ${props.email}`}
              spellcheck={false}
              value={props.value}
              disabled={props.disabled}
              onInput={(event) => props.onInput(event.currentTarget.value)}
            />
          </TabSelector.Panel>
        </TabSelector.Root>
        <ConfirmDialog
          open={confirmConversion()}
          onOpenChange={setConfirmConversion}
          title="Convert to rich text?"
          body="This signature uses custom HTML. Rich text editing can change its layout, tables, and spacing. Use HTML to keep the original formatting. Your saved signature stays unchanged until you save."
          confirmLabel="Continue to rich text"
          onConfirm={() => {
            setConfirmConversion(false);
            setView('rich-text');
          }}
        />
        <ConfirmDialog
          open={pastedHtml() !== undefined}
          onOpenChange={(open) => {
            if (!open) setPastedHtml(undefined);
          }}
          title="Replace with pasted signature?"
          body="This signature has a custom layout. Keep its HTML formatting and preview it before saving."
          confirmLabel="Use pasted signature"
          onConfirm={() => {
            const html = pastedHtml();
            if (html !== undefined) usePastedHtml(html);
          }}
        />
      </Show>
    </div>
  );
}
