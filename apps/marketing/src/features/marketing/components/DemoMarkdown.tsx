import { For, Match, Switch } from 'solid-js';
import './demo-markdown.css';

/** The sample transcripts only need emphasis, code, headings, and lists.
 * Keeping this renderer here avoids shipping an editor/runtime to the website.
 */
function Inline(props: { text: string }) {
  return (
    <For each={props.text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)}>
      {(part) => (
        <Switch fallback={part}>
          <Match when={part.startsWith('**') && part.endsWith('**')}>
            <strong class="font-bold">{part.slice(2, -2)}</strong>
          </Match>
          <Match when={part.startsWith('`') && part.endsWith('`')}>
            <code class="bg-inline-code font-mono rounded-xs md-inline-code p-0.5">
              {part.slice(1, -1)}
            </code>
          </Match>
        </Switch>
      )}
    </For>
  );
}

export function DemoMarkdown(props: {
  markdown: string;
  class?: string;
  channel?: boolean;
}) {
  return (
    <div
      class={`website-demo-markdown md max-w-full min-w-0 ${props.channel ? 'channel-markdown' : ''} ${props.class ?? ''}`}
    >
      <For each={props.markdown.split(/\n\s*\n/)}>
        {(block) => (
          <Switch
            fallback={
              <p class="my-4 first:mt-1.5 last:mb-1.5 md-p text-[1em] whitespace-pre-wrap">
                <Inline text={block} />
              </p>
            }
          >
            <Match when={block.startsWith('## ')}>
              <h2 class="text-[1.125em] font-semibold mb-2">
                <Inline text={block.slice(3)} />
              </h2>
            </Match>
            <Match when={block.startsWith('- ')}>
              <ul
                class="my-4 first:mt-1.5 last:mb-1.5 list-none md-list"
                classList={{
                  'md-check': block.startsWith('- ['),
                  'md-bullet': !block.startsWith('- ['),
                }}
              >
                <For each={block.split('\n')}>
                  {(line) => (
                    <li
                      class="my-[0.25em]"
                      classList={{
                        'checked md-strike text-ink-extra-muted':
                          line.startsWith('- [x] '),
                      }}
                    >
                      <Inline text={line.replace(/^- (?:\[[x ]\] )?/, '')} />
                    </li>
                  )}
                </For>
              </ul>
            </Match>
            <Match when={block.startsWith('> ')}>
              <blockquote class="border-l-2 border-edge pl-4 py-2 italic text-ink-muted my-4">
                <Inline text={block.slice(2)} />
              </blockquote>
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}

export function TextPart(props: { text: string }) {
  return (
    <div class="chat-markdown-container whitespace-pre-wrap wrap-break-word max-w-full text-base">
      <DemoMarkdown markdown={props.text} channel />
    </div>
  );
}
