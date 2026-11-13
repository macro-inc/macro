import {
  skillDescriptionProblem,
  useSetSkillDescription,
  useSkillDescriptionQuery,
} from '@queries/storage/skill-description';
import { Input } from '@ui';
import { createEffect, createSignal, Show } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { EditorSystemMessage } from './EditorSystemMessage';

/** Placeholder shared with the skill composer. */
export const SKILL_DESCRIPTION_PLACEHOLDER =
  'Use when … ; not … — agents load this skill for requests it describes';

/**
 * When to use a skill, edited in place under its title. Agents load the skill
 * for requests this one line describes; it saves on blur or Enter.
 */
export function SkillDescriptionField() {
  const { documentId, kind, permissions } = useMarkdownDocument();
  if (kind() !== 'skill') return null;

  const query = useSkillDescriptionQuery(documentId);
  const save = useSetSkillDescription(documentId);
  const [draft, setDraft] = createSignal('');
  const [problem, setProblem] = createSignal<string>();
  createEffect(() => {
    if (query.isSuccess) setDraft(query.data ?? '');
  });

  const commit = () => {
    const text = draft().trim();
    if (text === (query.data ?? '')) return;
    const invalid = skillDescriptionProblem(text);
    setProblem(invalid);
    if (invalid) return;
    save.mutate(text, {
      onError: (error) => setProblem(error.message),
    });
  };

  return (
    <div class="mb-3 flex flex-col gap-1">
      <Input
        variant="bare"
        size="sm"
        class="px-0 text-sm text-ink-muted"
        aria-label="When to use this skill"
        aria-invalid={problem() ? true : undefined}
        placeholder={SKILL_DESCRIPTION_PLACEHOLDER}
        maxLength={300}
        value={draft()}
        disabled={!permissions.canEdit() || query.isPending}
        onInput={(event) => {
          setDraft(event.currentTarget.value);
          if (problem()) setProblem(undefined);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <Show when={problem()}>
        {(message) => (
          <EditorSystemMessage variant="error">{message()}</EditorSystemMessage>
        )}
      </Show>
    </div>
  );
}
