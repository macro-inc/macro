import { queryApplication } from '@core/component/LexicalMarkdown/plugins/group-b/command';
import {
  type PersistentLocation,
  persistentLocationUrl,
} from '@core/component/LexicalMarkdown/plugins/location/locationPlugin';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal } from 'solid-js';
import { SnippetLinkButton } from '../SnippetLinkButton';

/** The model's selection snippet: Source `$getSelectionLocation`, text and end. */
export interface NativeSelectionSnippet {
  readonly location: PersistentLocation;
  readonly text: string;
  readonly end: {
    readonly key: number;
    readonly offset: number;
    readonly type: 'text' | 'element';
  };
}

const U32_MAX = 0xffff_ffff;

/** A native u32 (keys and offsets cross the bridge as nonnegative integers). */
function isU32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= U32_MAX
  );
}

function isPoint(value: unknown): value is { id: string; offset: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'offset' in value &&
    isU32(value.offset)
  );
}

/** Read `group-b.selection-snippet` against the current mirror generation. */
export function readNativeSelectionSnippet(
  view: EditorView
): NativeSelectionSnippet | null {
  const reply = queryApplication(view, 'group-b.selection-snippet', {});
  if (reply === null) return null;
  if (
    typeof reply !== 'object' ||
    !('location' in reply) ||
    !('text' in reply) ||
    !('end' in reply)
  )
    throw new Error('Invalid selection snippet query');
  const { location, text, end } = reply;
  if (
    typeof location !== 'object' ||
    location === null ||
    !('anchor' in location) ||
    !('focus' in location) ||
    !isPoint(location.anchor) ||
    !isPoint(location.focus) ||
    typeof text !== 'string' ||
    typeof end !== 'object' ||
    end === null ||
    !('key' in end) ||
    !isU32(end.key) ||
    !('offset' in end) ||
    !isU32(end.offset) ||
    !('type' in end) ||
    (end.type !== 'text' && end.type !== 'element')
  )
    throw new Error('Invalid selection snippet query');
  return {
    location: {
      type: 'persistent',
      anchor: { id: location.anchor.id, offset: location.anchor.offset },
      focus: { id: location.focus.id, offset: location.focus.offset },
    },
    text,
    end: { key: end.key, offset: end.offset, type: end.type },
  };
}

/**
 * Source MarkdownPopup handleShare over a native view: the URL is captured from
 * the model before the clipboard await; the popup stays open either way.
 */
export function createNativeSnippetLink(
  view: EditorView,
  options: { readonly documentId: Accessor<string> }
) {
  const [copied, setCopied] = createSignal(false);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  // Source resets the check icon when the selection changes; bind to actual
  // native selection commits rather than formatting metadata republication.
  const releaseCommits = view.onCommit((commit) => {
    if (commit.selectionChanged) setCopied(false);
  });
  const copy = async () => {
    if (disposed) return;
    const snippet = readNativeSelectionSnippet(view);
    // Source copies the document URL even without a location.
    const url = persistentLocationUrl(
      window.location.href,
      'md',
      options.documentId(),
      snippet?.location ?? null
    );
    try {
      await navigator.clipboard.writeText(url);
    } catch (error) {
      if (disposed) return;
      Telemetry.error(error, { surface: 'markdown-editor' });
      toast.failure('Could not copy link');
      return;
    }
    if (disposed) return;
    if (isTouchDevice()) toast.success('Link copied to clipboard');
    setCopied(true);
    const timer = setTimeout(() => {
      timers.delete(timer);
      setCopied(false);
    }, 2000);
    timers.add(timer);
  };
  return {
    copied,
    copy,
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseCommits();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

/** The popup slot for one live controller. */
export function NativeSnippetLinkControl(props: {
  link: ReturnType<typeof createNativeSnippetLink>;
}) {
  return (
    <SnippetLinkButton
      copied={props.link.copied()}
      // Query failures surface through fireAndForget, apart from clipboard rejection.
      onCopy={() => fireAndForget(props.link.copy(), 'native-snippet-link')}
    />
  );
}
