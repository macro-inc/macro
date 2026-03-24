import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import type { JSX } from 'solid-js';
import { buildConfig } from './MarkdownConfigBuilder';
import { MarkdownShell } from './MarkdownShell';

function Container(props: {
  label: string;
  description?: string;
  children: JSX.Element;
  footer?: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-2 w-full max-w-4xl p-4 bg-panel rounded-lg border border-edge min-h-100">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-ink">{props.label}</label>
        {props.description && (
          <span class="text-xs text-ink-muted">{props.description}</span>
        )}
      </div>
      <div class="h-px bg-edge" />
      <div class="h-48 overflow-y-auto">{props.children}</div>
      {props.footer && (
        <>
          <div class="h-px bg-edge" />
          <div class="text-xs text-ink-muted">{props.footer}</div>
        </>
      )}
    </div>
  );
}

function Editor() {
  const editor = buildConfig('markdown')
    .namespace('test-page')
    .withHistory()
    .withEmojis()
    .withMedia()
    .withMentions({
      onCreate: (args) => {
        console.log('CREATE MENTION', args);
      },
    })
    .withActions()
    .onEscape(() => {
      console.log('ESCAPE');
      return false;
    });

  editor.use((editor) => {
    console.log('CUSTOM PLUGIN', editor);
    return () => {};
  });

  return (
    <Container label="Builder Pattern">
      <MarkdownShell config={editor} placeholder="Cool test placeholder" />
    </Container>
  );
}

export default function BuilderTestPage() {
  return (
    <div class="flex flex-col h-full w-full">
      <SplitHeaderLeft>
        <StaticSplitLabel label="Markdown Editor Builder Pattern Test" />
      </SplitHeaderLeft>
      <div class="w-full h-full p-8 flex-1 flex flex-row flex-wrap gap-4 overflow-y-auto items-start justify-center content-start">
        <Editor />
      </div>
    </div>
  );
}
