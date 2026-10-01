import ArrowLeft from '@phosphor/arrow-left.svg';
import Check from '@phosphor/check.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { demoEmails } from '../../core/demo-email';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { EmailRows } from './frozen/EmailRows';
import { EmailShell } from './frozen/EmailShell';
import { EmailThread } from './frozen/EmailThread';
import './email-feature-demos.css';
import './email-keyboard-stage.css';

const inbox = demoEmails.slice(0, 4);
type Shortcut = 'j' | 'k' | 'e' | 'Enter' | 'Escape';

export function EmailKeyboardDemo() {
  let root!: HTMLDivElement;
  const [archived, setArchived] = createSignal<string[]>([]);
  const [index, setIndex] = createSignal(0);
  const [opened, setOpened] = createSignal(false);
  const [lastKey, setLastKey] = createSignal<Shortcut>();
  const emails = () => inbox.filter((email) => !archived().includes(email.id));
  const selected = () => emails()[index()];
  const act = (key: Shortcut) => {
    setLastKey(key);
    if (key === 'Escape') return setOpened(false);
    if (!selected()) return;
    if (key === 'j') setIndex(Math.min(index() + 1, emails().length - 1));
    if (key === 'k') setIndex(Math.max(index() - 1, 0));
    if (key === 'Enter') setOpened(true);
    if (key === 'e') {
      setArchived([...archived(), selected().id]);
      setIndex(Math.max(0, Math.min(index(), emails().length - 1)));
    }
  };
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: 6,
    reset: () => {
      setArchived([]);
      setIndex(0);
      setOpened(false);
      setLastKey(undefined);
    },
    reduced: () => {
      setOpened(false);
      setLastKey(undefined);
    },
    advance: (step) =>
      act((['Enter', 'j', 'j', 'k', 'e', 'Escape'] as const)[step - 1]),
  });
  const manual = (key: Shortcut) => {
    playback.pause();
    act(key);
    root.focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.isComposing ||
      event.defaultPrevented
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    const key = event.key;
    if (
      key !== 'j' &&
      key !== 'k' &&
      key !== 'e' &&
      key !== 'Enter' &&
      key !== 'Escape'
    )
      return;
    // Let native Enter activation work on controls.
    if (
      key === 'Enter' &&
      event.target instanceof HTMLElement &&
      event.target.closest('button, a')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    manual(key);
  };
  return (
    <div
      ref={root}
      class="email-keyboard-demo email-feature-demo"
      tabIndex={0}
      role="region"
      aria-label="Try email keyboard shortcuts"
      onKeyDown={onKeyDown}
    >
      <div class="email-keyboard-stage">
        <EmailShell label="Keyboard email demo" class="glass-input">
          <header class="email-feature-toolbar">
            <Show when={opened()} fallback={<span>Signal</span>}>
              <Button
                variant="plain"
                size="icon-sm"
                aria-label="Back to demo inbox"
                onClick={() => manual('Escape')}
              >
                <ArrowLeft />
              </Button>
              <span class="truncate">
                Signal{' '}
                <span class="email-toolbar-secondary">
                  / {selected()?.subject}
                </span>
              </span>
            </Show>
            <span class="email-toolbar-secondary">
              {emails().length} emails
            </span>
          </header>
          <div class="email-keyboard-content">
            <Show
              when={selected()}
              fallback={
                <div class="email-inbox-clear">
                  <Check />
                  <h3>All caught up.</h3>
                  <p>You’ve archived every email in this demo.</p>
                </div>
              }
            >
              <Show
                when={opened()}
                fallback={
                  <EmailRows
                    emails={emails()}
                    selectedId={selected()?.id}
                    onOpen={(email) => {
                      setIndex(
                        emails().findIndex((item) => item.id === email.id)
                      );
                      manual('Enter');
                    }}
                  />
                }
              >
                <EmailThread email={selected()!} hideHeader hideReply />
              </Show>
            </Show>
          </div>
        </EmailShell>
        <div class="email-shortcut-dock" aria-label="Email shortcut controls">
          <For
            each={
              [
                { key: 'j', label: 'Next' },
                { key: 'k', label: 'Previous' },
                { key: 'Enter', label: 'Open' },
                { key: 'e', label: 'Archive' },
                { key: 'Escape', label: 'Inbox' },
              ] as const
            }
          >
            {(shortcut) => (
              <button
                type="button"
                data-active={lastKey() === shortcut.key}
                disabled={!selected()}
                onClick={() => manual(shortcut.key)}
                aria-label={`${shortcut.label} email (${shortcut.key.toUpperCase()})`}
              >
                <kbd>
                  {shortcut.key === 'Enter'
                    ? '↵'
                    : shortcut.key === 'Escape'
                      ? 'esc'
                      : shortcut.key.toUpperCase()}
                </kbd>
                {shortcut.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
