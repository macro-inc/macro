import MailIcon from '@phosphor/envelope.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import FilterIcon from '@phosphor/funnel.svg';
import PlayIcon from '@phosphor/play.svg';
import SortIcon from '@phosphor/sort-ascending.svg';
import { createSignal, For, Match, Switch } from 'solid-js';
import { emailTags } from '../../core/demo-email';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { createViewStepper } from '../../primitives/createViewStepper';
import { EmailTags } from '../email/frozen/EmailRows';
import { DriveFileRows, DriveIcon } from './DriveFileRows';
import { type DriveFile, driveFiles, driveKinds } from './driveFiles';
import '../paper/database-views-graphic.css';
import './drive-stories.css';

const f = driveFiles;

/** Drive's top bar: its name, the list it shows, and the filter and sort tools. */
function DriveBar(props: { list: string }) {
  return (
    <div class="drive-bar">
      <FolderIcon class="drive-bar-mark" aria-hidden="true" />
      <strong>Drive</strong>
      <span class="drive-pill" data-active="">
        {props.list}
      </span>
      <span class="drive-pill drive-bar-tools" aria-hidden="true">
        <FilterIcon />
        <SortIcon />
      </span>
    </div>
  );
}

/**
 * An email attachment and a file posted in a channel each arrive in Drive as
 * a row that says where it came from.
 */
export function DriveArrivalsGraphic() {
  let root!: HTMLDivElement;
  // 1: the email's attachment lands. 2: the channel's file lands.
  const [phase, setPhase] = createSignal(0);
  createEmailWalkthrough({
    root: () => root,
    steps: 2,
    visibilityThreshold: 0.45,
    delay: (step) => [1300, 1700][step - 1],
    loop: { hold: 5000 },
    advance: setPhase,
    reset: () => setPhase(0),
    reduced: () => setPhase(2),
  });
  const files = (): DriveFile[] => [
    ...(phase() >= 2 ? [f.demo] : []),
    ...(phase() >= 1 ? [f.brand] : []),
    f.plan,
    f.budget,
    f.deck,
  ];
  return (
    <div ref={root} class="drive-story drive-arrivals">
      <div class="drive-sources">
        <div class="drive-source" data-sent={phase() >= 1}>
          <header>
            <MailIcon class="drive-source-mail" aria-hidden="true" />
            <strong>Austin Barron</strong>
            <span>9:41 AM</span>
          </header>
          <p>Our brand guidelines for the launch page.</p>
          <span class="drive-chip">
            <DriveIcon kind="pdf" />
            {f.brand.name}
          </span>
        </div>
        <div class="drive-source" data-sent={phase() >= 2}>
          <header>
            <img src={homepagePeople.julia.photo} alt="" />
            <strong>Julia</strong>
            <span>#launch · 9:38 AM</span>
          </header>
          <p>Recording from today’s customer demo.</p>
          <span class="drive-chip">
            <DriveIcon kind="video" />
            {f.demo.name}
          </span>
        </div>
      </div>
      <div class="drive-frame">
        <DriveBar list="Recent" />
        <DriveFileRows
          files={files()}
          fresh={phase() >= 2 ? [f.demo.id] : phase() >= 1 ? [f.brand.id] : []}
        />
      </div>
    </div>
  );
}

const openFiles = [f.brand, f.deck, f.homepage, f.demo] as const;

/** One viewer, four kinds of file: each tab opens where a document would. */
export function DriveFileTypesGraphic() {
  let root!: HTMLDivElement;
  const { view, choose } = createViewStepper(
    openFiles.map((file) => file.id),
    () => root
  );
  return (
    <div ref={root} class="drive-story drive-types">
      <div class="drive-frame">
        <div class="drive-tabs" role="group" aria-label="Open file">
          <For each={openFiles}>
            {(file) => (
              <button
                type="button"
                class="drive-tab"
                aria-pressed={view() === file.id}
                onClick={() => choose(file.id)}
              >
                <DriveIcon kind={file.kind} />
                <span>{file.name}</span>
              </button>
            )}
          </For>
        </div>
        <div class="drive-preview" data-view={view()}>
          <Switch>
            <Match when={view() === 'brand'}>
              <div class="drive-page">
                <small>Page 3 of 18</small>
                <h4>Colour</h4>
                <p>
                  Use the primary palette for product surfaces and keep the
                  accent for one action per screen.
                </p>
                <div class="drive-swatches">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <p>Text sits on the darkest surface at full contrast.</p>
              </div>
            </Match>
            <Match when={view() === 'deck'}>
              <div class="drive-deck">
                <div class="drive-thumbs">
                  <i />
                  <i data-current="" />
                  <i />
                  <i />
                </div>
                <div class="drive-slide">
                  <small>Slide 2 of 12</small>
                  <h4>Launching Thursday</h4>
                  <ul>
                    <li>Customer email goes out at 9</li>
                    <li>Changelog and pricing page go live</li>
                    <li>Demo for Parlor Studio at 2</li>
                  </ul>
                </div>
              </div>
            </Match>
            <Match when={view() === 'homepage'}>
              <div class="drive-canvas">
                <div class="drive-artboard">
                  <small>Homepage / Desktop</small>
                  <div>
                    <b />
                    <i />
                    <i />
                    <span />
                  </div>
                </div>
                <div class="drive-artboard" data-phone="">
                  <small>Mobile</small>
                  <div>
                    <b />
                    <i />
                    <span />
                  </div>
                </div>
              </div>
            </Match>
            <Match when={view() === 'demo'}>
              <div class="drive-video">
                <span class="drive-video-play">
                  <PlayIcon aria-hidden="true" />
                </span>
                <div class="drive-video-bar">
                  <span>12:48</span>
                  <i />
                  <span>31:05</span>
                </div>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}

const folders = [
  { name: 'Launch', files: [f.plan, f.budget, f.deck] },
  { name: 'Customers', count: 3 },
  { name: 'Brand', count: 2 },
] as const;
const databaseRows = [f.plan, f.budget, f.deck, f.brand, f.demo] as const;
const storageViews = [
  { id: 'folders', label: 'Folders' },
  { id: 'database', label: 'Database' },
] as const;

/** The same files as nested folders and as a database of typed properties. */
export function DriveViewsGraphic() {
  let root!: HTMLDivElement;
  const { view, choose } = createViewStepper(
    storageViews.map((item) => item.id),
    () => root
  );
  return (
    <div ref={root} class="database-views drive-views">
      <div class="database-views-bar">
        <FolderIcon class="drive-bar-mark" aria-hidden="true" />
        <strong>Files</strong>
        <div class="database-views-tabs" role="group" aria-label="File view">
          <For each={storageViews}>
            {(item) => (
              <button
                type="button"
                class="database-views-pill"
                aria-pressed={view() === item.id}
                onClick={() => choose(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <span
          class="database-views-pill database-views-extra"
          aria-hidden="true"
        >
          <FilterIcon />
          <SortIcon />
        </span>
      </div>
      <div class="database-views-body" data-view={view()}>
        <Switch>
          <Match when={view() === 'folders'}>
            <For each={folders}>
              {(folder) => (
                <>
                  <div class="drive-folder" data-open={'files' in folder}>
                    <i />
                    <DriveIcon kind="folder" />
                    <strong>{folder.name}</strong>
                    <span>
                      {'files' in folder ? folder.files.length : folder.count}{' '}
                      files
                    </span>
                  </div>
                  <For each={'files' in folder ? folder.files : []}>
                    {(file) => (
                      <div class="drive-folder-file">
                        <DriveIcon kind={file.kind} />
                        <span>{file.name}</span>
                        <small>{file.updated}</small>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
          </Match>
          <Match when={view() === 'database'}>
            <div class="database-views-row database-views-columns">
              <span>#</span>
              <span>Name</span>
              <span>Type</span>
              <span>Tags</span>
              <span class="drive-views-wide">Added by</span>
            </div>
            <For each={databaseRows}>
              {(file, index) => (
                <div class="database-views-row">
                  <span class="database-views-number">{index() + 1}</span>
                  <span class="database-views-name">{file.name}</span>
                  <span>
                    <DriveIcon kind={file.kind} />
                    {driveKinds[file.kind].label}
                  </span>
                  <span>
                    <EmailTags tags={file.tags} />
                  </span>
                  <span class="database-views-owner drive-views-wide">
                    <img src={homepagePeople[file.owner].photo} alt="" />
                    {homepagePeople[file.owner].shortName}
                  </span>
                </div>
              )}
            </For>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

const customers = emailTags.find((tag) => tag.id === 'customers');

/** Drive filtered to one tag: every file for a customer, wherever it came from. */
export function DriveTagsGraphic() {
  return (
    <div class="drive-story drive-tags">
      <div class="drive-frame">
        <div class="drive-bar">
          <FolderIcon class="drive-bar-mark" aria-hidden="true" />
          <strong>Drive</strong>
          <span class="drive-pill">Type</span>
          <span class="drive-pill" data-active="">
            <i style={{ background: customers?.color }} />
            Tag: {customers?.label}
          </span>
          <span class="drive-pill drive-tags-wide">Added by</span>
        </div>
        <DriveFileRows files={[f.brand, f.demo, f.contract]} />
        <p class="drive-count">3 files tagged {customers?.label}</p>
      </div>
    </div>
  );
}

const playbook: DriveFile[] = [
  {
    id: 'review',
    name: 'Contract review',
    kind: 'skill',
    owner: 'jacob',
    updated: 'Sep 28',
  },
  {
    id: 'reply',
    name: 'Support reply',
    kind: 'snippet',
    owner: 'julia',
    updated: 'Sep 27',
  },
  {
    id: 'onboarding',
    name: 'Onboarding checklist',
    kind: 'note',
    owner: 'teo',
    updated: 'Sep 26',
  },
  { ...f.contract, source: undefined },
];

/** A folder that keeps a skill and a snippet beside the files they are used on. */
export function DriveLibraryGraphic() {
  return (
    <div class="drive-story drive-library">
      <div class="drive-frame">
        <div class="drive-bar">
          <FolderIcon class="drive-bar-mark" aria-hidden="true" />
          <strong>Drive</strong>
          <span class="drive-crumb">›</span>
          <strong>Customer playbook</strong>
        </div>
        <DriveFileRows
          files={playbook}
          detail={(file) => driveKinds[file.kind].label}
        />
      </div>
    </div>
  );
}
