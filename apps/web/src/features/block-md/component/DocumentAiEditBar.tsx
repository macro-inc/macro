import { applyAiOps } from '@block-md/ai-edit/applyAiOps';
import { mdStore } from '@block-md/signal/markdownBlockData';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import clickOutside from '@core/directive/clickOutside';
import { TOKENS } from '@core/hotkey/tokens';
import { AnimatedStarIcon } from '@icon/wide-star';
import { cancelAiEdit, requestAiEdit } from '@service-ai-editing/client';
import { Button, SendButton, Surface } from '@ui';
import { createSignal, Show } from 'solid-js';

false && clickOutside;

/**
 * Right-aligned "Edit with AI" pill above the document discussion that expands
 * into a prompt card matching the Discussion composer.
 */
export function DocumentAiEditBar(props: { documentId: string }) {
  const md = mdStore.get;

  const [expanded, setExpanded] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [hovering, setHovering] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [prompt, setPrompt] = createSignal('');

  const editor = buildChatEditor();

  const collapse = () => {
    setExpanded(false);
    md.editor?.focus();
  };

  const submit = () => {
    const value = prompt().trim();
    if (!value || editing()) return;
    editor.controls.clear();
    setPrompt('');
    collapse();
    setEditing(true);

    requestAiEdit({
      documentId: props.documentId,
      prompt: value,
      onOps: (ops) => {
        const target = md.editor;
        const mapping = md.mapping;
        if (target && mapping) applyAiOps(target, mapping, ops);
      },
    })
      .then((result) => {
        if (result === 'failed') toast.failure('AI edit failed');
      })
      .finally(() => setEditing(false));
  };

  editor
    .onEnter(() => {
      submit();
      return true;
    })
    .onEscape(() => {
      collapse();
      return true;
    })
    .onChange((markdown) => setPrompt(markdown));

  return (
    <div class="flex justify-end">
      {/* breathe keyframe for the star while an edit runs */}
      <style>{`
        @keyframes ai-edit-breathe {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.18); }
        }
        .ai-edit-star-breathing {
          animation: ai-edit-breathe 1.8s ease-in-out infinite;
          transform-origin: center;
        }
      `}</style>
      <Show
        when={expanded()}
        fallback={
          <Button
            onClick={() => {
              if (editing()) cancelAiEdit(props.documentId);
              else setExpanded(true);
            }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            tooltip={editing() ? 'Stop AI edit' : 'Ask AI to edit'}
            hotkey={editing() ? undefined : TOKENS.chat.input.focus}
            variant="ghost"
            size="sm"
            depth={2}
            class="gap-1.5 rounded-full px-2.5 ring ring-edge-muted"
          >
            <span
              class="flex size-4 shrink-0 items-center justify-center"
              classList={{
                'ai-edit-star-breathing text-accent': editing(),
              }}
            >
              <AnimatedStarIcon triggerAnimation={hovering() && !editing()} />
            </span>
            <span
              class="text-xs font-medium"
              classList={{ 'text-ink-muted': editing() && !hovering() }}
            >
              {editing() ? (hovering() ? 'Stop' : 'Editing…') : 'Edit with AI'}
            </span>
          </Button>
        }
      >
        <Surface
          onFocusIn={() => setFocused(true)}
          onFocusOut={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && event.currentTarget.contains(next)) return;
            setFocused(false);
          }}
          use:clickOutside={collapse}
          active={focused()}
          class="w-96 max-w-full rounded-xl"
          depth={2}
          solid
        >
          <div class="flex flex-col gap-2 p-3">
            <div class="flex items-start gap-2">
              <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center text-accent">
                <AnimatedStarIcon triggerAnimation={focused()} />
              </span>
              <div class="min-w-0 grow text-sm text-ink">
                <MarkdownShell
                  config={editor}
                  placeholder="Describe the edit…"
                  autofocus
                />
              </div>
            </div>
            <div class="flex items-center justify-end">
              <SendButton
                tooltip="Send edit"
                shortcut="enter"
                disabled={prompt().trim().length === 0}
                onClick={submit}
              />
            </div>
          </div>
        </Surface>
      </Show>
    </div>
  );
}
