import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import type { EditorControls } from '@core/component/LexicalMarkdown/builder/types';
import { Scroll } from '@ui';

/** The Markdown body of the project composer, edited like a new task's. */
export function ProjectDescriptionComposer(props: {
  initialValue: string;
  disabled: boolean;
  onChange(markdown: string): void;
  onSubmit(): void;
  /** Keyboard focus left the start of the description, or Escape was pressed. */
  onLeaveStart(): void;
  ref(controls: EditorControls): void;
}) {
  const panel = useSplitPanel();
  const config = buildConfig('markdown')
    .withAppLinkResolver(useMacroMentionLinkResolver())
    .withMentions()
    .withEmojis()
    .withCode()
    .withSelectionData()
    .withFloatingFormatMenu()
    .withHistory()
    .onChange(props.onChange)
    .onEnter((event) => {
      if (!(event.metaKey || event.ctrlKey) || event.isComposing) return false;
      props.onSubmit();
      return true;
    })
    .onFocusLeave({
      onStart: (event) => {
        event.preventDefault();
        props.onLeaveStart();
      },
      onEnd: () => {},
    })
    .onEscape(() => {
      props.onLeaveStart();
      return true;
    });
  const handle = config.buildHandle();
  props.ref(handle.controls);

  return (
    <Scroll>
      <MarkdownShell
        config={config}
        initialValue={props.initialValue || undefined}
        disabled={props.disabled}
        placeholder="Add description..."
        portalScope={panel?.handle.isPopover() ? 'local' : 'block'}
      />
    </Scroll>
  );
}
