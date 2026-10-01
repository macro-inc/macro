import ArrowLeft from '@phosphor/arrow-left.svg';
import Code from '@phosphor/code.svg';
import FileText from '@phosphor/file-text.svg';
import Hash from '@phosphor/hash.svg';
import Shapes from '@phosphor/shapes.svg';
import Share from '@phosphor/share.svg';
import Table from '@phosphor/table.svg';
import { Button } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { DemoMarkdown } from '../DemoMarkdown';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { SearchBar } from '../email/frozen/SearchBar';
import { DemoTags, TagDot } from './frozen/DemoTags';
import {
  DetailLayout,
  PanelGrid,
  PanelRow,
  PanelSection,
  PanelToggle,
} from './frozen/DetailPanel';
import { PersonIcon } from './frozen/TaskProperties';

// Retain the subset of Markdown represented by the frozen editor presentation.
function markdownFrom(element: HTMLElement): string {
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    const el = node as HTMLElement;
    const content = Array.from(el.childNodes).map(inline).join('');
    if (el.tagName === 'STRONG' || el.tagName === 'B') return `**${content}**`;
    if (el.tagName === 'I' || el.tagName === 'EM') return `*${content}*`;
    if (el.tagName === 'BR') return '\n';
    return content;
  };
  if (!element.children.length) return element.textContent ?? '';
  return Array.from(element.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      const el = node as HTMLElement;
      if (/^H[1-6]$/.test(el.tagName))
        return `${'#'.repeat(Number(el.tagName.slice(1)))} ${inline(el)}`;
      if (el.tagName === 'UL')
        return Array.from(el.children)
          .map(
            (li) =>
              `- ${el.classList.contains('md-check') ? `[${li.classList.contains('checked') ? 'x' : ' '}] ` : ''}${inline(li)}`
          )
          .join('\n');
      return inline(el);
    })
    .join('\n\n');
}

export function WorkspaceDocuments(props: {
  workspace: DummyWorkspace;
  relatedContent?: JSX.Element;
  onShare?: () => void;
}) {
  const w = props.workspace;
  const [panel, setPanel] = createSignal<boolean>();
  const selected = () =>
    w.data.documents.find((doc) => doc.id === w.selected());
  const save = (patch: { title?: string; body?: string; tags?: string[] }) =>
    w.setData('documents', (doc) => doc.id === w.selected(), patch);
  return (
    <Show
      when={selected()}
      fallback={
        <>
          <ViewShell.TopBar>
            <span class="text-sm font-medium">
              {w.view() === 'home' ? 'Home' : w.fileView()}
            </span>
            <Button
              size="sm"
              class="ml-auto"
              onClick={() => {
                const id = crypto.randomUUID();
                w.setData('documents', (docs) => [
                  ...docs,
                  {
                    id,
                    title: 'Untitled document',
                    body: 'Write something…',
                    comments: [],
                  },
                ]);
                w.openItem('documents', id);
              }}
            >
              New document
            </Button>
          </ViewShell.TopBar>
          <div class="p-4 max-w-[600px]">
            <SearchBar
              label="Search files"
              placeholder="Search files"
              value={w.query()}
              onValueChange={w.setQuery}
              hotkey="cmd+f"
            />
          </div>
          <div class="dummy-scroll px-2">
            <For
              each={w.data.documents
                .filter(
                  (doc) =>
                    w.fileView() !== 'Shared with me' || doc.id === 'rollout'
                )
                .filter((doc) =>
                  `${doc.title} ${doc.body}`
                    .toLowerCase()
                    .includes(w.query().toLowerCase())
                )}
            >
              {(doc) => (
                <button
                  type="button"
                  class="flex items-center gap-3 w-full text-left px-6 min-h-11 rounded-xl hover:bg-list-hover text-sm"
                  onClick={() =>
                    w.openItem(
                      doc.kind === 'spreadsheet' ? 'spreadsheet' : 'documents',
                      doc.id
                    )
                  }
                >
                  <Show
                    when={doc.kind === 'spreadsheet'}
                    fallback={
                      <Show
                        when={doc.kind === 'canvas'}
                        fallback={
                          <Show
                            when={doc.kind === 'code'}
                            fallback={
                              <FileText class="size-4 shrink-0 text-[#a17fda]" />
                            }
                          >
                            <Code class="size-4 shrink-0 text-success" />
                          </Show>
                        }
                      >
                        <Shapes class="size-4 shrink-0 text-warning" />
                      </Show>
                    }
                  >
                    <Table class="size-4 shrink-0 text-success" />
                  </Show>
                  <span class="truncate flex-1">{doc.title}</span>
                  <div class="hidden sm:flex gap-2">
                    <For each={doc.tags}>
                      {(tag) => (
                        <span class="sample-file-tag">
                          <TagDot label={tag} />
                          {tag}
                        </span>
                      )}
                    </For>
                  </div>
                  <span class="text-right w-20 shrink-0 text-xs text-ink-extra-muted">
                    {doc.updated ?? 'Today'}
                  </span>
                </button>
              )}
            </For>
          </div>
        </>
      }
    >
      {(doc) => (
        <>
          <ViewShell.TopBar>
            <Button
              variant="plain"
              size="icon-sm"
              label={w.view() === 'home' ? 'Back to Home' : 'Back to files'}
              onClick={() => w.backToCollection('documents')}
            >
              <ArrowLeft />
            </Button>
            <Show when={w.view() === 'home'}>
              <button
                type="button"
                class="text-sm text-ink-muted"
                onClick={() => w.open('home')}
              >
                Home
              </button>
              <span class="text-ink-muted px-1">›</span>
            </Show>
            <FileText class="size-4 text-document" />
            <span class="text-sm truncate">{doc().title}</span>
            <Button
              size="sm"
              class="ml-auto"
              onClick={() => {
                if (props.onShare) {
                  props.onShare();
                  return;
                }
                w.post(
                  `Shared document: ${doc().title}`,
                  undefined,
                  undefined,
                  doc().id
                );
                w.openItem('messages');
              }}
            >
              <Show when={props.onShare} fallback={<Hash />}>
                <Share />
              </Show>
              {props.onShare ? 'Share' : 'Share in channel'}
            </Button>
            <PanelToggle open={panel()} onChange={setPanel} />
          </ViewShell.TopBar>
          <DetailLayout
            open={panel()}
            panel={
              <>
                <PanelSection title="Actions" open>
                  <Button
                    size="sm"
                    variant="plain"
                    onClick={() => w.openItem('agents')}
                  >
                    ✧ Ask Macro
                  </Button>
                </PanelSection>
                <PanelSection title="Details" open>
                  <PanelGrid>
                    <PanelRow label="Owner">Jacob Beckerman</PanelRow>
                    <PanelRow label="Created">Sep 28, 2026</PanelRow>
                    <PanelRow label="Last updated">Today</PanelRow>
                  </PanelGrid>
                </PanelSection>
                <PanelSection title="Tags" open>
                  <DemoTags
                    tags={doc().tags ?? []}
                    onChange={(tags) => save({ tags })}
                  />
                </PanelSection>
                <PanelSection title="Sharing" open>
                  <p class="text-xs text-ink-muted">Launch team can edit</p>
                </PanelSection>
                <PanelSection title="References">
                  <button
                    type="button"
                    onClick={() => {
                      w.setChannel('launch');
                      w.openItem('messages');
                    }}
                  >
                    #launch
                  </button>
                </PanelSection>
                <PanelSection title="History">
                  Changes stay in this session.
                </PanelSection>
              </>
            }
          >
            <div class="dummy-scroll px-6">
              <div class="mx-auto max-w-3xl pt-12 pb-12">
                <div
                  role="textbox"
                  aria-label="Document title"
                  contentEditable
                  class="text-2xl font-semibold outline-none mb-6"
                  onBlur={(e) =>
                    save({
                      title:
                        e.currentTarget.innerText.trim() || 'Untitled document',
                    })
                  }
                >
                  {doc().title}
                </div>
                <div class="mb-6">
                  <DemoTags
                    tags={doc().tags ?? []}
                    onChange={(tags) => save({ tags })}
                  />
                </div>
                <div
                  contentEditable
                  role="textbox"
                  aria-label="Document body"
                  aria-multiline="true"
                  class="outline-none text-base"
                  onBlur={(e) => {
                    const content = e.currentTarget.querySelector<HTMLElement>(
                      '.website-demo-markdown'
                    );
                    save({ body: markdownFrom(content ?? e.currentTarget) });
                  }}
                  onClick={(e) => {
                    const li = (e.target as HTMLElement).closest('li');
                    if (li?.parentElement?.classList.contains('md-check')) {
                      const bounds = li.getBoundingClientRect();
                      if (e.clientX < bounds.left) {
                        li.classList.toggle('checked');
                        li.classList.toggle('md-strike');
                      }
                    }
                  }}
                >
                  <DemoMarkdown markdown={doc().body} />
                </div>
                {props.relatedContent}
                <div class="mt-8 mb-3 text-xs text-ink-muted">Discussion</div>
                <For each={doc().comments}>
                  {(comment) => (
                    <div class="flex items-start gap-2 mb-4 text-sm">
                      <PersonIcon person={comment.person} />
                      <p>{comment.body}</p>
                    </div>
                  )}
                </For>
                <ChannelComposer
                  label="Comment on document"
                  placeholder="Leave a comment…"
                  onSend={(body) => w.comment(doc().id, body, true)}
                />
              </div>
            </div>
          </DetailLayout>
        </>
      )}
    </Show>
  );
}
