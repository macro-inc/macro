import { For, type JSX, Show } from 'solid-js';
import { DocMentionIcon, type DocMentionItem } from './DocMention';
import '../demo-mentions.css';

export type DocMentionGroup = {
  /** MentionsMenu bucket labels, e.g. "Documents, Agents, & Tasks". */
  label: string;
  /** Bucket size; "View all (N)" appears when more exist than are shown. */
  total?: number;
  rows: readonly DocMentionItem[];
};

/**
 * MentionsMenu's Surface, ItemBin, and MentionsMenuItem as a still frame the
 * walkthrough drives: buckets in the editor's order and one selected row.
 */
export function DocMentionMenu(props: {
  groups: readonly DocMentionGroup[];
  selected: number;
  style?: JSX.CSSProperties;
}) {
  const offset = (index: number) =>
    props.groups
      .slice(0, index)
      .reduce((count, group) => count + group.rows.length, 0);
  return (
    <div
      class="demo-mention-menu"
      role="listbox"
      aria-label="Mentions"
      style={props.style}
    >
      <div class="demo-mention-groups">
        <For each={props.groups}>
          {(group, index) => (
            <section>
              <div class="demo-mention-heading">
                <span>{group.label}</span>
                <Show when={(group.total ?? 0) > group.rows.length}>
                  <span>View all ({group.total})</span>
                </Show>
              </div>
              <For each={group.rows}>
                {(row, rowIndex) => (
                  <div
                    role="option"
                    class="demo-mention-option"
                    aria-selected={
                      offset(index()) + rowIndex() === props.selected
                    }
                  >
                    <Show
                      when={row.photo}
                      fallback={<DocMentionIcon kind={row.kind} />}
                    >
                      {(photo) => <img src={photo()} alt="" />}
                    </Show>
                    <span>
                      {row.label}
                      <Show when={row.detail}>
                        <span class="demo-mention-detail">{row.detail}</span>
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}
