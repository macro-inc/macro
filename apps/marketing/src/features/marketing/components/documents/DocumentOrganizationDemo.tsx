import ArrowLeft from '@phosphor/arrow-left.svg';
import Envelope from '@phosphor/envelope.svg';
import FileText from '@phosphor/file-text.svg';
import Folder from '@phosphor/folder.svg';
import ListChecks from '@phosphor/list-checks.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { createDemoPointer } from '../agents/createDemoPointer';
import { DemoCursor } from '../DemoCursor';
import { ViewShell } from '../DemoWorkspaceChrome';
import { SearchBar } from '../email/frozen/SearchBar';
import { ProductDemo } from '../product/ProductPage';
import { TagDot } from '../workspace/frozen/DemoTags';
import { DocumentFrame } from './DocumentFrame';
import { DocumentSourceView } from './DocumentProjectDemo';
import { PROJECT_INTRO, PROJECT_TAGS, PROJECT_TITLE } from './documentProject';

type Collection = 'Website' | 'Images' | 'Launch' | 'Product';
const rows = [
  {
    id: 'brief',
    title: PROJECT_TITLE,
    kind: 'doc',
    folder: 'Website',
    tags: ['Launch', 'Product'],
    updated: '10:24 AM',
    body: '',
  },
  {
    id: 'copy',
    title: 'Homepage copy',
    kind: 'doc',
    folder: 'Website',
    tags: ['Launch'],
    updated: 'Yesterday',
    body: 'Lead with what the product does. Keep the opening short and show the product before the signup button.',
  },
  {
    id: 'voice',
    title: 'Writing guidelines',
    kind: 'doc',
    folder: 'Website',
    tags: ['Product'],
    updated: 'Tuesday',
    body: 'Use short sentences. Name the action. Read it out loud before publishing.',
  },
  {
    id: 'images',
    title: 'Images',
    kind: 'folder',
    folder: 'Website',
    tags: [],
    updated: 'Tuesday',
    body: '',
  },
  {
    id: 'email',
    title: 'Pricing changes',
    kind: 'email',
    folder: '',
    tags: ['Launch'],
    updated: '9:17 AM',
    body: '',
  },
  {
    id: 'task',
    title: 'Update pricing page',
    kind: 'task',
    folder: '',
    tags: ['Launch', 'Product'],
    updated: '10:18 AM',
    body: '',
  },
  {
    id: 'notes',
    title: 'Launch notes',
    kind: 'doc',
    folder: '',
    tags: ['Launch'],
    updated: 'Yesterday',
    body: 'Send the announcement after the pricing page goes live. Include one screenshot and a link to the new page.',
  },
  {
    id: 'image-notes',
    title: 'Screenshot checklist',
    kind: 'doc',
    folder: 'Images',
    tags: [],
    updated: 'Tuesday',
    body: 'Capture the homepage at desktop and phone widths. Use the light background for the announcement.',
  },
];

/** Frozen folder list and tag-filtered search, with one persistent document. */
export function DocumentOrganizationDemo() {
  let root!: HTMLDivElement;
  const [collection, setCollection] = createSignal<Collection>('Website');
  const [selected, setSelected] = createSignal<string>();
  const [query, setQuery] = createSignal('');
  const [automatic, setAutomatic] = createSignal(true);
  const [pointAt, setPointAt] = createSignal<string>();
  let returnFocus: HTMLElement | undefined;
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 5,
    reset: () => {},
    reduced: () => {
      setAutomatic(false);
    },
    delay: (step) => [0, 1600, 1000, 2200, 1100, 1000][step] ?? 1000,
    advance: (step) => {
      if (step === 1) setPointAt('[data-doc-row="brief"]');
      if (step === 2) {
        setSelected('brief');
        setPointAt(undefined);
      }
      if (step === 3) setPointAt('[data-doc-tag="Launch"]');
      if (step === 4) {
        setCollection('Launch');
        setSelected(undefined);
        setPointAt(undefined);
      }
      if (step === 5) setAutomatic(false);
    },
  });
  const pause = () => {
    setAutomatic(false);
    setPointAt(undefined);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target: () => (automatic() ? pointAt() : undefined),
  });
  const changeCollection = (next: Collection) => {
    pause();
    setCollection(next);
    setSelected(undefined);
    setQuery('');
    queueMicrotask(() =>
      root
        .querySelector<HTMLInputElement>('.doc-collection input')
        ?.focus({ preventScroll: true })
    );
  };
  const open = (id: string) => {
    pause();
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setSelected(id);
    queueMicrotask(() =>
      [
        ...root.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Back to collection"]'
        ),
      ]
        .find((button) => !button.closest('[hidden]'))
        ?.focus({ preventScroll: true })
    );
  };
  const back = () => {
    pause();
    setSelected(undefined);
    queueMicrotask(() => returnFocus?.focus({ preventScroll: true }));
  };
  const tagged = () => collection() === 'Launch' || collection() === 'Product';
  const items = () =>
    rows.filter(
      (row) =>
        (tagged()
          ? row.tags.includes(collection())
          : row.folder === collection()) &&
        row.title.toLowerCase().includes(query().toLowerCase())
    );
  const other = () =>
    rows.find((row) => row.id === selected() && row.id !== 'brief');
  return (
    <div class="doc-story doc-organization" ref={root}>
      <ProductDemo
        label="Explore folders and tags"
        height={520}
        mobileHeight={570}
        onInteract={pause}
      >
        <div
          class="doc-organizer"
          data-open={!!selected()}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && selected()) {
              event.stopPropagation();
              back();
            }
          }}
        >
          <div class="doc-collection" hidden={!!selected()}>
            <ViewShell.TopBar>
              <Show when={collection() !== 'Website'}>
                <Button
                  variant="plain"
                  size="icon-sm"
                  label="Back to Website folder"
                  onClick={() => changeCollection('Website')}
                >
                  <ArrowLeft />
                </Button>
              </Show>
              <Show when={tagged()} fallback={<Folder class="size-4" />}>
                <TagDot label={collection()} />
              </Show>
              <span class="text-sm">{tagged() ? 'Search' : collection()}</span>
            </ViewShell.TopBar>
            <div class="doc-collection-search">
              <SearchBar
                label="Search this collection"
                placeholder={tagged() ? 'Search tagged items' : 'Search folder'}
                value={query()}
                onValueChange={setQuery}
              />
            </div>
            <Show when={tagged()}>
              <div class="doc-filter">
                <span>Tags</span>
                <TagDot label={collection()} />
                <b>{collection()}</b>
                <button
                  type="button"
                  aria-label="Clear tag filter"
                  onClick={() => changeCollection('Website')}
                >
                  <X class="size-3" />
                </button>
              </div>
            </Show>
            <div class="dummy-scroll doc-collection-rows">
              <For each={items()}>
                {(row) => (
                  <button
                    type="button"
                    data-doc-row={row.id}
                    class="doc-collection-row"
                    onClick={() =>
                      row.kind === 'folder'
                        ? changeCollection('Images')
                        : open(row.id)
                    }
                  >
                    <Show
                      when={row.kind === 'email'}
                      fallback={
                        <Show
                          when={row.kind === 'task'}
                          fallback={
                            <Show
                              when={row.kind === 'folder'}
                              fallback={<FileText class="text-note" />}
                            >
                              <Folder />
                            </Show>
                          }
                        >
                          <ListChecks class="text-task" />
                        </Show>
                      }
                    >
                      <Envelope />
                    </Show>
                    <span>{row.title}</span>
                    <div class="doc-row-tags">
                      <For each={row.tags}>
                        {(tag) => (
                          <span>
                            <TagDot label={tag} />
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                    <time>{row.updated}</time>
                  </button>
                )}
              </For>
              <Show when={!items().length}>
                <p class="p-6 text-sm text-ink-muted">No matching items</p>
              </Show>
            </div>
          </div>
          <div
            class="doc-organized-page dummy-main"
            hidden={selected() !== 'brief'}
          >
            <DocumentFrame
              title={PROJECT_TITLE}
              tags={PROJECT_TAGS}
              onBack={back}
              backLabel="Back to collection"
              tagsContent={
                <div class="doc-click-tags">
                  <For each={PROJECT_TAGS}>
                    {(tag) => (
                      <button
                        type="button"
                        data-doc-tag={tag}
                        onClick={() =>
                          changeCollection(
                            tag === 'Launch' ? 'Launch' : 'Product'
                          )
                        }
                      >
                        <TagDot label={tag} />
                        {tag}
                      </button>
                    )}
                  </For>
                </div>
              }
            >
              <h2>What we’re changing</h2>
              <p>
                Make the homepage easier to scan. Show what the product does
                before asking people to sign up.
              </p>
              <h2>Pricing</h2>
              <p>{PROJECT_INTRO}</p>
              <h2>Before we publish</h2>
              <p>
                Teo checks mobile. Julia reviews the copy. Jacob tests signup.
              </p>
            </DocumentFrame>
          </div>
          <Show when={other()}>
            {(row) => (
              <Show
                when={row().kind === 'doc'}
                fallback={
                  <DocumentSourceView
                    source={row().kind === 'email' ? 'email' : 'task'}
                    onClose={back}
                    autoFocus
                  />
                }
              >
                <div class="dummy-main">
                  <DocumentFrame
                    title={row().title}
                    tags={row().tags}
                    onBack={back}
                    backLabel="Back to collection"
                  >
                    <p>{row().body}</p>
                  </DocumentFrame>
                </div>
              </Show>
            )}
          </Show>
        </div>
      </ProductDemo>
      <Show when={pointer()}>
        {(p) => (
          <DemoCursor
            label="Julia"
            class="doc-organize-pointer"
            style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
