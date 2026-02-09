/**
 * @file Test page for the markdown editor builder pattern.
 *
 * Navigate to this page at: /md-builder (in LOCAL_ONLY mode)
 */

import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { createSignal, type JSX } from 'solid-js';
import { createMarkdownEditor } from './createMarkdownEditor';

// ─────────────────────────────────────────────────────────────
// Container Component
// ─────────────────────────────────────────────────────────────

function Container(props: {
  label: string;
  description?: string;
  children: JSX.Element;
  footer?: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-2 w-full max-w-xl p-4 bg-panel rounded-lg border border-edge">
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

// ─────────────────────────────────────────────────────────────
// Test 1: Minimal Editor
// ─────────────────────────────────────────────────────────────

function MinimalEditor() {
  const { Editor } = createMarkdownEditor()
    .namespace('minimal-editor')
    .withHistory()
    .build();

  return (
    <Container
      label="1. Minimal Editor"
      description=".namespace('minimal-editor').withHistory()"
    >
      <Editor placeholder="Just history, nothing else..." />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 2: Chat-like Input with Enter Handler
// ─────────────────────────────────────────────────────────────

function ChatInput() {
  const [messages, setMessages] = createSignal<string[]>([]);

  const { Editor, controls } = createMarkdownEditor('chat')
    .namespace('chat-input')
    .withMentions()
    .withHistory()
    .onEnter((_e, markdown) => {
      if (markdown.trim()) {
        setMessages((prev) => [...prev, markdown]);
        controls.clear();
      }
      return true;
    })
    .build();

  return (
    <Container
      label="2. Chat Input"
      description="createMarkdownEditor('chat').withMentions().withHistory().onEnter(...).build()"
      footer={
        <div class="flex flex-col gap-1">
          <span>Sent messages ({messages().length}):</span>
          {messages().map((msg, i) => (
            <code class="text-xs bg-hover p-1 rounded">
              {i + 1}: {msg.slice(0, 50)}
              {msg.length > 50 ? '...' : ''}
            </code>
          ))}
        </div>
      }
    >
      <Editor placeholder="Type @ for mentions, Enter to send..." autofocus />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 3: Single Line Title Editor
// ─────────────────────────────────────────────────────────────

function TitleInput() {
  const [title, setTitle] = createSignal('');

  // Use 'chat' type: has mention nodes but no heading shortcuts
  const { Editor } = createMarkdownEditor('chat')
    .namespace('title-input')
    .singleLine()
    .withMentions({ sources: ['emojis'] })
    .onChange((md) => setTitle(md))
    .build();

  return (
    <Container
      label="3. Single Line Title"
      description="createMarkdownEditor().singleLine().withMentions({ sources: ['emojis'] }).onChange(...).build()"
      footer={<span>Title: {title() || '(empty)'}</span>}
    >
      <Editor placeholder="Enter title... (type : for emojis)" />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 4: Full Featured Editor
// ─────────────────────────────────────────────────────────────

function FullFeaturedEditor() {
  const [charCount, setCharCount] = createSignal(0);

  const { Editor, controls } = createMarkdownEditor()
    .namespace('full-featured')
    .withMentions()
    .withLinks()
    .withHistory()
    .onChange((md) => setCharCount(md.length))
    .build();

  return (
    <Container
      label="4. Full Featured"
      description="createMarkdownEditor().withMentions().withLinks().withHistory().onChange(...).build()"
      footer={
        <div class="flex justify-between">
          <span>Characters: {charCount()}</span>
          <button
            class="text-accent hover:underline"
            onClick={() => controls.clear()}
          >
            Clear
          </button>
        </div>
      }
    >
      <Editor
        placeholder="Full featured: @ mentions, links, history..."
        initialValue="Try **bold**, *italic*, or type @ for mentions!"
      />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 5: Controlled Editor with External State
// ─────────────────────────────────────────────────────────────

function ControlledEditor() {
  const [externalValue, setExternalValue] = createSignal(
    '# Hello\n\nExternal state!'
  );

  const { Editor, controls } = createMarkdownEditor()
    .namespace('controlled-editor')
    .withHistory()
    .onChange((md) => setExternalValue(md))
    .build();

  return (
    <Container
      label="5. Controlled with External State"
      description="Using controls.setMarkdown() and controls.getMarkdown()"
      footer={
        <div class="flex gap-2">
          <button
            class="px-2 py-1 bg-accent text-accent-ink rounded text-xs"
            onClick={() =>
              controls.setMarkdown('# Reset\n\nContent was reset!')
            }
          >
            Reset to Default
          </button>
          <button
            class="px-2 py-1 bg-hover rounded text-xs"
            onClick={() => controls.setMarkdown('')}
          >
            Clear
          </button>
          <button
            class="px-2 py-1 bg-hover rounded text-xs"
            onClick={() => alert(controls.getMarkdown())}
          >
            Alert Content
          </button>
        </div>
      }
    >
      <Editor placeholder="Edit me..." initialValue={externalValue()} />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 6: Escape Handler
// ─────────────────────────────────────────────────────────────

function EscapeHandlerEditor() {
  const [escapeCount, setEscapeCount] = createSignal(0);

  const { Editor } = createMarkdownEditor()
    .namespace('escape-handler')
    .withHistory()
    .onEscape(() => {
      setEscapeCount((c) => c + 1);
      return true;
    })
    .build();

  return (
    <Container
      label="6. Escape Handler"
      description="createMarkdownEditor().withHistory().onEscape(...).build()"
      footer={<span>Escape pressed: {escapeCount()} times</span>}
    >
      <Editor placeholder="Press Escape..." />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 7: No Mentions (Plain)
// ─────────────────────────────────────────────────────────────

function PlainEditor() {
  const { Editor } = createMarkdownEditor()
    .namespace('plain-editor')
    .withHistory()
    .build();

  return (
    <Container
      label="7. Plain Editor (No Mentions)"
      description="createMarkdownEditor().withHistory().build() - no withMentions()"
    >
      <Editor placeholder="Plain editor, @ does nothing special..." />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 8: Focus/Blur Controls
// ─────────────────────────────────────────────────────────────

function FocusControlEditor() {
  const { Editor, controls } = createMarkdownEditor()
    .namespace('focus-control')
    .withMentions()
    .withHistory()
    .build();

  return (
    <Container
      label="8. Focus/Blur Controls"
      description="Using controls.focus() and controls.blur()"
      footer={
        <div class="flex gap-2">
          <button
            class="px-2 py-1 bg-accent text-accent-ink rounded text-xs"
            onClick={() => controls.focus()}
          >
            Focus
          </button>
          <button
            class="px-2 py-1 bg-hover rounded text-xs"
            onClick={() => controls.blur()}
          >
            Blur
          </button>
        </div>
      }
    >
      <Editor placeholder="Click the buttons below to focus/blur..." />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Test 9: Custom Plugin Registration
// ─────────────────────────────────────────────────────────────

function CustomPluginEditor() {
  const [keyPresses, setKeyPresses] = createSignal<string[]>([]);

  const { Editor, plugins } = createMarkdownEditor()
    .namespace('custom-plugin')
    .withHistory()
    .build();

  // Register a custom plugin inline
  plugins.use((editor) => {
    return editor.registerCommand(
      { type: 'keydown' } as any,
      (e: KeyboardEvent) => {
        if (e.key === '/') {
          setKeyPresses((prev) => [...prev, `/ pressed at ${Date.now()}`]);
        }
        return false; // Don't prevent default
      },
      1
    );
  });

  return (
    <Container
      label="9. Custom Plugin via plugins.use()"
      description="Register inline plugins after build()"
      footer={
        <div class="flex flex-col gap-1 max-h-16 overflow-auto">
          {keyPresses().map((k) => (
            <code class="text-xs">{k}</code>
          ))}
        </div>
      }
    >
      <Editor placeholder="Type / to trigger custom plugin..." />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Test Page
// ─────────────────────────────────────────────────────────────

export default function BuilderTestPage() {
  return (
    <div class="flex flex-col h-full w-full">
      <SplitHeaderLeft>
        <StaticSplitLabel label="Markdown Editor Builder Pattern Test" />
      </SplitHeaderLeft>
      <div class="w-full h-full p-8 flex-1 flex flex-row flex-wrap gap-4 overflow-y-auto items-start justify-center content-start">
        <MinimalEditor />
        <ChatInput />
        <TitleInput />
        <FullFeaturedEditor />
        <ControlledEditor />
        <EscapeHandlerEditor />
        <PlainEditor />
        <FocusControlEditor />
        <CustomPluginEditor />
      </div>
    </div>
  );
}
