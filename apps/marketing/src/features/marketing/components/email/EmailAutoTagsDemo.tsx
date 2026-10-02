import ArrowLeft from '@phosphor/arrow-left.svg';
import Check from '@phosphor/check.svg';
import Tag from '@phosphor/tag.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { DocsDemoPointer } from '../../../../app/components/featureGraphics/DocsMarkdownScene';
import {
  type DemoEmail,
  demoEmails,
  type EmailTagId,
  emailTags,
} from '../../core/demo-email';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { EmailRows } from './frozen/EmailRows';
import { EmailShell } from './frozen/EmailShell';
import { EmailThread } from './frozen/EmailThread';
import './email-feature-demos.css';
import './email-auto-tags-stage.css';

const incoming = demoEmails.slice(0, 4);

export function EmailAutoTagsDemo() {
  let root!: HTMLDivElement;
  const [tags, setTags] = createSignal<Record<string, EmailTagId[]>>({});
  const [selected, setSelected] = createSignal(0);
  const [menu, setMenu] = createSignal(false);
  const [opened, setOpened] = createSignal(false);
  const [step, setStep] = createSignal(0);
  const emails = () =>
    incoming.map((email) => ({ ...email, tags: tags()[email.id] ?? [] }));
  const email = () => emails()[selected()];
  const finish = () => {
    setTags(
      Object.fromEntries(incoming.map((email) => [email.id, email.tags ?? []]))
    );
    setMenu(false);
    setStep(9);
  };
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: 9,
    reset: () => {
      setTags({});
      setSelected(0);
      setMenu(false);
      setOpened(false);
      setStep(0);
    },
    reduced: finish,
    advance: (next) => {
      setStep(next);
      if (next === 9) return finish();
      const index = Math.floor((next - 1) / 2);
      setSelected(index);
      setMenu(next % 2 === 1);
      if (next % 2 === 0)
        setTags((previous) => ({
          ...previous,
          [incoming[index].id]: incoming[index].tags ?? [],
        }));
    },
  });
  const toggleTag = (tag: EmailTagId) => {
    playback.pause();
    const id = email().id;
    const current = tags()[id] ?? [];
    setTags({
      ...tags(),
      [id]: current.includes(tag)
        ? current.filter((value) => value !== tag)
        : [...current, tag],
    });
  };
  const open = (item: DemoEmail) => {
    playback.pause();
    setSelected(incoming.findIndex((email) => email.id === item.id));
    setMenu(false);
    setOpened(true);
  };
  return (
    <div
      ref={root}
      class="email-tags-demo email-feature-demo"
      data-step={step()}
      data-opened={opened()}
    >
      <div class="email-tag-stage">
        <EmailShell label="Automatic email tagging demo" class="glass-input">
          <header class="email-feature-toolbar">
            <Show
              when={opened()}
              fallback={
                <span>
                  Signal{' '}
                  <span class="email-toolbar-secondary">/ Incoming mail</span>
                </span>
              }
            >
              <Button
                variant="plain"
                size="icon-sm"
                aria-label="Back to incoming email"
                onClick={() => {
                  setOpened(false);
                  setMenu(false);
                }}
              >
                <ArrowLeft />
              </Button>
              <span class="truncate">{email().subject}</span>
            </Show>
            <span class="email-tag-count" role="status">
              {Object.values(tags()).filter((value) => value.length).length} /{' '}
              {incoming.length} tagged
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="ml-auto"
              aria-label="Edit selected email tags"
              aria-expanded={menu()}
              onClick={() => {
                playback.pause();
                setMenu(!menu());
              }}
            >
              <Tag />
              Tags
            </Button>
          </header>
          <Show
            when={opened()}
            fallback={
              <EmailRows
                emails={emails()}
                selectedId={email().id}
                onOpen={open}
              />
            }
          >
            <EmailThread email={email()} hideHeader hideReply />
          </Show>
          <Show when={menu()}>
            <div
              class="email-auto-tag-menu"
              role="group"
              aria-label={`Tags for ${email().subject}`}
            >
              <div class="email-auto-tag-menu-title">
                <span>Add tags</span>
                <Button
                  variant="plain"
                  size="icon-sm"
                  aria-label="Close tags"
                  onClick={() => {
                    playback.pause();
                    setMenu(false);
                  }}
                >
                  <X />
                </Button>
              </div>
              <For each={emailTags}>
                {(tag) => (
                  <button
                    type="button"
                    aria-pressed={email().tags.includes(tag.id)}
                    onClick={() => toggleTag(tag.id)}
                  >
                    <span
                      class="email-tag-dot"
                      style={{ background: tag.color }}
                    />
                    {tag.label}
                    <Show when={email().tags.includes(tag.id)}>
                      <Check />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={playback.playing() && !playback.reducedMotion()}>
            <div
              class="email-agent-pointer"
              data-menu={menu()}
              style={{
                '--email-cursor-row': selected(),
                '--email-tag-index': Math.max(
                  0,
                  emailTags.findIndex(
                    (tag) => tag.id === incoming[selected()].tags?.[0]
                  )
                ),
              }}
              aria-hidden="true"
            >
              <DocsDemoPointer />
              <span>Claude</span>
            </div>
          </Show>
        </EmailShell>
      </div>
    </div>
  );
}
