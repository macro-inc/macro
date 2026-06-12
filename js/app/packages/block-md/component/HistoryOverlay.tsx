import type { LoroManager } from '@core/collab/manager';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { Button } from '@ui';
import type { SerializedEditorState } from 'lexical';
import { type Accessor, createMemo, Show } from 'solid-js';

/**
 * Read-only Lexical editor overlaid on top of the live editor that we use to
 * display history in.
 */
export function HistoryOverlay(props: {
  loroManager: Accessor<LoroManager | undefined>;
  onClose: () => void;
}) {
  const latestState = createMemo<SerializedEditorState | undefined>(() => {
    const json = props.loroManager()?.getDoc().toJSON();
    if (!json || typeof json !== 'object' || !('root' in json))
      return undefined;
    return json as SerializedEditorState;
  });

  const config = buildConfig('markdown')
    .withMentions()
    .withMedia()
    .withLinks()
    .withCode();

  return (
    <div class="absolute inset-0 z-20 overflow-y-auto bg-surface">
      {/* Floated so it doesn't push the historical body down (keeps it aligned). */}
      <div class="absolute right-1 top-1 z-30">
        <Button variant="active" onClick={props.onClose}>
          Go back to latest
        </Button>
      </div>
      <Show when={latestState()}>
        {(state) => (
          <MarkdownShell
            config={config}
            initialState={state()}
            disabled
            class="ph-no-capture w-full max-w-full [&>*:first-child>*:first-child]:mt-0"
          />
        )}
      </Show>
    </div>
  );
}
