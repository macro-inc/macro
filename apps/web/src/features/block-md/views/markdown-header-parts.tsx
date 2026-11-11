import { Show } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';

/** Marks a skill beside its title. */
export function SkillBadge() {
  const { kind } = useMarkdownDocument();

  return (
    <Show when={kind() === 'skill'}>
      <span class="ml-1.5 inline-flex shrink-0 items-center self-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
        Skill
      </span>
    </Show>
  );
}
