import Building from '@phosphor/building-office.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Currency from '@phosphor/currency-dollar.svg';
import Grip from '@phosphor/dots-six-vertical.svg';
import Dots from '@phosphor/dots-three.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import Table from '@phosphor/table.svg';
import Users from '@phosphor/users.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkspaceView } from '../../core/dummy-workspace';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';
import { type DealStage, dealStages } from '../../core/workspace-fixtures';
import { createCrmDemoWorkspace } from '../../primitives/createCrmDemoWorkspace';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { CompanyPipelineEntry } from '../crm/CompanyPipelineEntry';
import { CrmHeroSidebar } from '../crm/CrmHeroSidebar';
import { crmHeroLists, crmHeroPipelines } from '../crm/crm-hero-data';
import { DemoCursor } from '../DemoCursor';
import { DEMO_INTERACTION_EVENT } from '../DemoInteractionBoundary';
import { ViewSidebar } from '../DemoViewSidebar';
import { ViewShell } from '../DemoWorkspaceChrome';
import { DocumentShareSheet } from '../documents/DocumentShareSheet';
import { SearchBar } from '../email/frozen/SearchBar';
import { StageIcon } from '../workspace/CompanyRecord';
import {
  type CompanySection,
  WorkspaceCompanies,
} from '../workspace/WorkspaceCompanies';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import './homepage-scenes.css';
import '../crm/pipeline-transfer.css';

type Deal = {
  pipelineId?: string;
  companyId: string;
  stage: DealStage;
  owner: HomepagePersonId | '';
  revenue: string;
};
const owners = ['julia', 'jacob', 'gabriel', 'teo'] as const;

/** Website-owned presentation from CRM's records, pipeline sidebar and database toolbar. */
export default function CrmPipelineScene(
  props: { compact?: boolean; hero?: boolean } = {}
) {
  let scene!: HTMLDivElement;
  let collectionScroll!: HTMLDivElement;
  const [pointerTarget, setPointerTarget] = createSignal<string>();
  const [operating, setOperating] = createSignal(true);
  const compactStages: DealStage[] = ['Demo', 'Negotiation', 'Customer'];
  const compactIds = [
    'meadow',
    'bluebird',
    'sable',
    'northwind',
    'lumen',
    'relay',
    'pallet',
  ];
  const [pipelineId, setPipelineId] = createSignal(crmHeroPipelines[0].id);
  const selectedPipeline = () =>
    crmHeroPipelines.find((pipeline) => pipeline.id === pipelineId())!;
  const pipelineName = () =>
    props.hero ? selectedPipeline().name : 'Sales pipeline';
  const stages = () =>
    props.compact
      ? compactStages
      : props.hero
        ? selectedPipeline().stages
        : dealStages;
  const [transfer, setTransfer] = createSignal<{
    id: string;
    name: string;
    owner: HomepagePersonId | '';
    revenue: string;
    x: number;
    y: number;
    width: number;
    dx: number;
    dy: number;
  }>();
  const w = createCrmDemoWorkspace();
  const [recordSection, setRecordSection] =
    createSignal<CompanySection>('overview');

  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [tab, setTab] = createSignal('pipeline');
  const [query, setQuery] = createSignal('');
  const [board, setBoard] = createSignal(true);
  const [share, setShare] = createSignal(false);
  const [linked, setLinked] = createSignal<{
    view: WorkspaceView;
    id: string;
  }>();
  // Pipeline fields belong to the deal, independently of the company record.
  const [deals, setDeals] = createStore<Deal[]>(
    props.hero
      ? crmHeroPipelines.flatMap((pipeline) =>
          pipeline.deals.map((deal) => ({ ...deal, pipelineId: pipeline.id }))
        )
      : w.data.companies
          .filter(
            (entry) =>
              entry.stage !== 'Churned' &&
              (!props.compact || compactIds.includes(entry.id))
          )
          .map((entry) => ({
            companyId: entry.id,
            stage:
              props.compact && entry.id === 'lumen'
                ? 'Negotiation'
                : entry.stage,
            owner: entry.owner,
            revenue: (entry.revenue ?? '').replaceAll(',', ''),
          }))
  );
  const matchesDeal = (deal: Deal, id: string) =>
    deal.companyId === id && (!props.hero || deal.pipelineId === pipelineId());
  const move = (id: string, stage: DealStage) => {
    setDeals((deal) => matchesDeal(deal, id), 'stage', stage);
    if (props.compact)
      w.setData('companies', (entry) => entry.id === id, 'stage', stage);
  };
  const startTransfer = (id: string, destination: DealStage) => {
    const card = scene.querySelector<HTMLElement>(
      `[data-pipeline-company="${id}"]`
    );
    const lane = scene.querySelector<HTMLElement>(
      `[aria-label="${destination} deals"]`
    );
    if (!card || !lane) return;
    const root = scene.getBoundingClientRect();
    const scaleX = scene.offsetWidth ? root.width / scene.offsetWidth : 1;
    const scaleY = scene.offsetHeight ? root.height / scene.offsetHeight : 1;
    const from = card.getBoundingClientRect();
    const to = lane.getBoundingClientRect();
    const first = lane.querySelector('article')?.getBoundingClientRect();
    const deal = deals.find((entry) => matchesDeal(entry, id));
    setPointerTarget('.landing-pipeline-transfer .homepage-pipeline-grip');
    setTransfer({
      id,
      name: w.data.companies.find((entry) => entry.id === id)?.name ?? '',
      owner: deal?.owner ?? '',
      revenue: deal?.revenue ?? '',
      x: (from.left - root.left) / scaleX,
      y: (from.top - root.top) / scaleY,
      width: from.width / scaleX,
      dx: ((first?.left ?? to.left + 9 * scaleX) - from.left) / scaleX,
      dy: ((first?.top ?? to.top + 54 * scaleY) - from.top) / scaleY,
    });
  };
  const approachCard = (id: string) => {
    const card = scene.querySelector<HTMLElement>(
      `[data-pipeline-company="${id}"]`
    );
    if (card && collectionScroll) {
      const bounds = card.getBoundingClientRect();
      const viewport = collectionScroll.getBoundingClientRect();
      if (bounds.left < viewport.left || bounds.right > viewport.right)
        collectionScroll.scrollTo({
          left: collectionScroll.scrollLeft + bounds.left - viewport.left - 16,
          behavior: 'smooth',
        });
    }
    setPointerTarget(`[data-pipeline-company="${id}"] .homepage-pipeline-grip`);
  };
  const showViewPointer = (view: 'table' | 'board') =>
    setPointerTarget(`[data-crm-view="${view}"]`);
  const pointer = createDemoPointer({
    frame: () => scene,
    target: pointerTarget,
    active: operating,
    followAnimation: () => !!transfer(),
  });
  const previewView = (showBoard: boolean) => {
    setPointerTarget(undefined);
    setBoard(showBoard);
    collectionScroll.scrollLeft = 0;
    collectionScroll.scrollTop = 0;
  };
  const walkthrough = props.compact
    ? createProductWalkthrough({
        root: () => scene,
        steps: 12,
        visibilityThreshold: 0.5,
        reset: () => {},
        delay: (step) =>
          [
            0, 1800, 800, 1500, 1800, 800, 1500, 1800, 650, 2200, 650, 3500,
            650,
          ][step] ?? 1400,
        reduced: () => {
          move('meadow', 'Negotiation');
          move('lumen', 'Customer');
          setTransfer(undefined);
        },
        advance: (step) => {
          if (step === 1) approachCard('meadow');
          if (step === 4) approachCard('lumen');
          if (step === 2) startTransfer('meadow', 'Negotiation');
          if (step === 3) {
            move('meadow', 'Negotiation');
            setTransfer(undefined);
          }
          if (step === 5) startTransfer('lumen', 'Customer');
          if (step === 6) {
            move('lumen', 'Customer');
            setTransfer(undefined);
          }
          if (step === 7) {
            setPointerTarget(
              '[data-pipeline-company="meadow"] .homepage-pipeline-company'
            );
          }
          if (step === 8) {
            w.setCompanyFilter('Sales pipeline');
            w.open('crm', 'meadow');
          }
          if (step === 9) setPointerTarget('[data-record-tab="emails"]');
          if (step === 10) setRecordSection('emails');
          if (step === 11)
            setPointerTarget('[aria-label="Back to Sales pipeline"]');
          if (step === 12) w.open('crm');
        },
      })
    : props.hero
      ? createProductWalkthrough({
          root: () => scene,
          steps: 7,
          visibilityThreshold: 0.5,
          reset: () => {},
          delay: (step) => [0, 2200, 800, 1500, 2200, 600, 3000, 600][step],
          reduced: () => {
            move('northstar', 'Qualified');
            setTransfer(undefined);
            setPointerTarget(undefined);
            setBoard(true);
          },
          advance: (step) => {
            if (step === 1) approachCard('northstar');
            if (step === 2) startTransfer('northstar', 'Qualified');
            if (step === 3) {
              move('northstar', 'Qualified');
              setTransfer(undefined);
              const lane = scene.querySelector<HTMLElement>(
                '[aria-label="Qualified deals"]'
              );
              if (lane) {
                const viewport = collectionScroll.getBoundingClientRect();
                const bounds = lane.getBoundingClientRect();
                if (bounds.right > viewport.right) {
                  collectionScroll.scrollTo?.({
                    left:
                      collectionScroll.scrollLeft +
                      bounds.left -
                      viewport.left -
                      16,
                    behavior: 'smooth',
                  });
                }
              }
            }
            if (step === 4) showViewPointer('table');
            if (step === 5) previewView(false);
            if (step === 6) showViewPointer('board');
            if (step === 7) previewView(true);
          },
        })
      : undefined;
  const takeOver = () => {
    setOperating(false);
    walkthrough?.pause();
    setTransfer(undefined);
    setPointerTarget(undefined);
  };
  onMount(() => {
    if (!props.hero && !props.compact) return;
    const boundary = scene.closest('.demo-interaction-boundary');
    boundary?.addEventListener(DEMO_INTERACTION_EVENT, takeOver);
    onCleanup(() =>
      boundary?.removeEventListener(DEMO_INTERACTION_EVENT, takeOver)
    );
  });
  const company = (id: string) =>
    w.data.companies.find((item) => item.id === id)!;
  const shownDeals = () =>
    deals.filter(
      (deal) =>
        (!props.hero || deal.pipelineId === pipelineId()) &&
        company(deal.companyId)
          .name.toLowerCase()
          .includes(query().toLowerCase())
    );
  const selectedList = () =>
    crmHeroLists.find((list) => tab() === `list:${list.id}`);
  const collectionName = () =>
    tab() === 'pipeline'
      ? pipelineName()
      : tab() === 'contacts'
        ? 'Contacts'
        : tab() === 'customers'
          ? 'Customers'
          : (selectedList()?.name ?? 'All companies');
  const shownCompanies = () =>
    w.data.companies.filter(
      (item) =>
        (!selectedList() || selectedList()!.companyIds.includes(item.id)) &&
        `${item.name} ${item.domain}`
          .toLowerCase()
          .includes(query().toLowerCase())
    );
  const navigate = (next: string) => {
    setTab(next);
    setSidebarOpen(false);
    setQuery('');
    w.open('crm');
    setLinked(undefined);
  };
  const openCompany = (id: string) => {
    takeOver();
    setRecordSection('overview');
    w.setCompanyFilter(collectionName());
    w.open('crm', id);
  };
  const linkedWorkspace = {
    ...w,
    selected: () => linked()?.id,
    view: (): WorkspaceView => linked()?.view ?? 'crm',
    contentView: (): WorkspaceView => linked()?.view ?? 'crm',
    backToCollection: () => setLinked(undefined),
  };
  const stageCell = (deal: Deal) => (
    <Dropdown modal={false}>
      <Dropdown.Trigger
        variant="plain"
        size="sm"
        aria-label={`Stage for ${company(deal.companyId).name}`}
      >
        <StageIcon stage={deal.stage} />
        <span>{deal.stage}</span>
        <CaretDown class="size-3" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
        <Dropdown.Group>
          <For
            each={(props.hero ? stages() : dealStages).filter(
              (stage) => stage !== 'No stage'
            )}
          >
            {(stage) => (
              <Dropdown.Item
                onSelect={() =>
                  setDeals(
                    (item) => matchesDeal(item, deal.companyId),
                    'stage',
                    stage
                  )
                }
              >
                <StageIcon stage={stage} />
                {stage}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
  const ownerCell = (deal: Deal) => (
    <Dropdown modal={false}>
      <Dropdown.Trigger
        variant="plain"
        size="sm"
        aria-label={`Owner for ${company(deal.companyId).name}`}
      >
        <Show
          when={deal.owner ? homepagePeople[deal.owner] : undefined}
          fallback="Unassigned"
        >
          {(person) => (
            <>
              <img class="size-5 rounded-full" src={person().photo} alt="" />
              {person().name}
            </>
          )}
        </Show>
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
        <Dropdown.Group>
          <For each={owners}>
            {(owner) => (
              <Dropdown.Item
                onSelect={() =>
                  setDeals(
                    (item) => matchesDeal(item, deal.companyId),
                    'owner',
                    owner
                  )
                }
              >
                {homepagePeople[owner].name}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
  const revenueCell = (deal: Deal) => (
    <input
      class="homepage-crm-value"
      aria-label={`Revenue for ${company(deal.companyId).name}`}
      inputMode="decimal"
      value={deal.revenue}
      onChange={(event) => {
        const value = event.currentTarget.value.replace(/[$,\s]/g, '');
        if (value === '' || /^\d+(\.\d{0,2})?$/.test(value))
          setDeals(
            (item) => matchesDeal(item, deal.companyId),
            'revenue',
            value
          );
        else event.currentTarget.value = deal.revenue;
      }}
    />
  );
  return (
    <div
      ref={scene}
      class="dummy-workspace homepage-crm-scene portal-scope"
      data-compact={props.compact}
      data-hero={props.hero}
      data-sidebar-open={sidebarOpen()}
      onPointerDown={takeOver}
      onKeyDown={takeOver}
      onClick={props.hero ? takeOver : undefined}
      onFocusIn={props.hero ? takeOver : undefined}
    >
      <Show when={!props.compact}>
        <aside class="homepage-crm-sidebar">
          <Show
            when={!props.hero}
            fallback={
              <CrmHeroSidebar
                tab={tab()}
                pipelineId={pipelineId()}
                onNavigate={navigate}
                onPipeline={(id) => {
                  setPipelineId(id);
                  navigate('pipeline');
                }}
              />
            }
          >
            <ViewSidebar.Root aria-label="CRM navigation">
              <ViewSidebar.Header>
                <ViewSidebar.Title>Customers</ViewSidebar.Title>
              </ViewSidebar.Header>
              <ViewSidebar.Content>
                <section>
                  <p class="homepage-crm-section-label">Records</p>
                  <ViewSidebar.Nav>
                    <ViewSidebar.Item
                      active={tab() === 'companies'}
                      onClick={() => navigate('companies')}
                    >
                      <Building class="size-4" />
                      Companies
                    </ViewSidebar.Item>
                    <ViewSidebar.Item
                      active={tab() === 'contacts'}
                      onClick={() => navigate('contacts')}
                    >
                      <Users class="size-4" />
                      Contacts
                    </ViewSidebar.Item>
                  </ViewSidebar.Nav>
                </section>
                <section>
                  <p class="homepage-crm-section-label">Pipelines</p>
                  <ViewSidebar.Nav>
                    <ViewSidebar.Item
                      active={tab() === 'pipeline'}
                      onClick={() => navigate('pipeline')}
                    >
                      <Table class="size-4" />
                      <span class="flex-1">Sales pipeline</span>
                      <span class="text-xs text-ink-extra-muted">Team</span>
                    </ViewSidebar.Item>
                  </ViewSidebar.Nav>
                </section>
                <section>
                  <p class="homepage-crm-section-label">Lists</p>
                  <ViewSidebar.Nav>
                    <ViewSidebar.Item
                      active={tab() === 'customers'}
                      onClick={() => navigate('customers')}
                    >
                      <Users class="size-4" />
                      Customers
                    </ViewSidebar.Item>
                  </ViewSidebar.Nav>
                </section>
              </ViewSidebar.Content>
            </ViewSidebar.Root>
          </Show>
        </aside>
      </Show>
      <main class="dummy-main homepage-crm-main">
        <Show
          when={!linked()}
          fallback={
            <>
              <ViewShell.TopBar>
                <Button
                  variant="plain"
                  size="sm"
                  onClick={() => setLinked(undefined)}
                >
                  Back to customer
                </Button>
              </ViewShell.TopBar>
              <Show
                when={linked()?.view === 'email'}
                fallback={<WorkspaceDocuments workspace={linkedWorkspace} />}
              >
                <WorkspaceEmail
                  workspace={linkedWorkspace}
                  tab="all"
                  account="all"
                />
              </Show>
            </>
          }
        >
          <Show
            when={!w.selected()}
            fallback={
              <WorkspaceCompanies
                workspace={w}
                pipeline={(record) => {
                  const deal = () =>
                    deals.find((entry) => matchesDeal(entry, record.id));
                  return (
                    <Show when={deal()}>
                      {(entry) => (
                        <CompanyPipelineEntry
                          name={pipelineName()}
                          stages={props.hero ? stages() : undefined}
                          value={entry()}
                          onChange={(patch) =>
                            setDeals(
                              (item) => matchesDeal(item, record.id),
                              patch
                            )
                          }
                          onOpen={() => {
                            w.open('crm');
                            setTab('pipeline');
                          }}
                        />
                      )}
                    </Show>
                  );
                }}
                section={props.compact ? recordSection() : undefined}
                onSectionChange={props.compact ? setRecordSection : undefined}
                onOpenItem={(view, id) => setLinked({ view, id })}
              />
            }
          >
            <ViewShell.TopBar class="homepage-crm-header">
              <Show when={!props.compact}>
                <Button
                  class="homepage-crm-nav-toggle"
                  variant="plain"
                  size="icon-sm"
                  aria-label="Toggle CRM navigation"
                  aria-expanded={sidebarOpen()}
                  onClick={() => setSidebarOpen((open) => !open)}
                >
                  <Sidebar class="size-4" />
                </Button>
              </Show>
              <h1 class="text-sm font-semibold flex-1">{collectionName()}</h1>
              <Show when={tab() === 'pipeline'}>
                <Button
                  variant="plain"
                  size="sm"
                  onClick={() => setShare(true)}
                >
                  Share
                </Button>
              </Show>
            </ViewShell.TopBar>
            <Show when={!props.compact}>
              <Show
                when={tab() === 'pipeline'}
                fallback={
                  <div class="homepage-crm-search">
                    <SearchBar
                      label="Search records"
                      placeholder="Search records"
                      value={query()}
                      onValueChange={setQuery}
                    />
                  </div>
                }
              >
                <div class="homepage-crm-toolbar">
                  <div class="flex items-center gap-1" aria-label="Views">
                    <Button
                      variant="ghost"
                      size="md"
                      aria-pressed={!board()}
                      data-crm-view="table"
                      onClick={() => setBoard(false)}
                    >
                      All records
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      aria-pressed={board()}
                      data-crm-view="board"
                      onClick={() => setBoard(true)}
                    >
                      By stage
                    </Button>
                  </div>
                  <div class={props.hero ? 'crm-hero-search' : undefined}>
                    <SearchBar
                      label="Search pipeline"
                      placeholder="Search"
                      value={query()}
                      onValueChange={setQuery}
                    />
                  </div>
                </div>
              </Show>
            </Show>
            <div ref={collectionScroll} class="dummy-scroll">
              <Show
                when={tab() === 'pipeline'}
                fallback={
                  <Show
                    when={tab() === 'contacts'}
                    fallback={
                      <table class="homepage-crm-table">
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Stage</th>
                            <th>Owner</th>
                            <th>Revenue</th>
                            <th>Last Interaction</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For
                            each={shownCompanies().filter(
                              (item) =>
                                tab() !== 'customers' ||
                                item.stage === 'Customer'
                            )}
                          >
                            {(item) => (
                              <tr>
                                <td>
                                  <button onClick={() => openCompany(item.id)}>
                                    <Building class="size-4" />
                                    <span>
                                      {item.name}
                                      <small>{item.domain}</small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <StageIcon stage={item.stage} /> {item.stage}
                                </td>
                                <td>
                                  {item.owner &&
                                    homepagePeople[item.owner].name}
                                </td>
                                <td>
                                  {item.revenue ? `$${item.revenue}` : ''}
                                </td>
                                <td>{item.updated}</td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    }
                  >
                    <table class="homepage-crm-table">
                      <thead>
                        <tr>
                          <th>Contact</th>
                          <th>Email</th>
                          <th>Company</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={shownCompanies()}>
                          {(item) => (
                            <For each={item.contacts}>
                              {(contact) => (
                                <tr>
                                  <td>{contact.name}</td>
                                  <td>{contact.email}</td>
                                  <td>
                                    <button
                                      onClick={() => openCompany(item.id)}
                                    >
                                      {item.name}
                                    </button>
                                  </td>
                                </tr>
                              )}
                            </For>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </Show>
                }
              >
                <Show
                  when={board()}
                  fallback={
                    <table
                      class="homepage-crm-table"
                      aria-label={pipelineName()}
                    >
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Stage</th>
                          <th>Owner</th>
                          <th>Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={shownDeals()}>
                          {(deal) => (
                            <tr>
                              <td>
                                <button
                                  aria-label={company(deal.companyId).name}
                                  onClick={() => openCompany(deal.companyId)}
                                >
                                  <Building class="size-4" />
                                  <span>
                                    {company(deal.companyId).name}
                                    <small>
                                      {company(deal.companyId).domain}
                                    </small>
                                  </span>
                                </button>
                              </td>
                              <td>{stageCell(deal)}</td>
                              <td>{ownerCell(deal)}</td>
                              <td>{revenueCell(deal)}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  }
                >
                  <div
                    class="homepage-pipeline-board"
                    role="region"
                    aria-label={`${pipelineName()} board`}
                  >
                    <For each={stages()}>
                      {(stage) => (
                        <section
                          aria-label={`${stage} deals`}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const id =
                              event.dataTransfer?.getData('text/plain');
                            if (id)
                              setDeals(
                                (deal) => matchesDeal(deal, id),
                                'stage',
                                stage
                              );
                          }}
                        >
                          <header>
                            <StageIcon stage={stage} />
                            {stage}
                            <span>
                              {
                                shownDeals().filter(
                                  (deal) => deal.stage === stage
                                ).length
                              }
                            </span>
                          </header>
                          <For
                            each={shownDeals().filter(
                              (deal) => deal.stage === stage
                            )}
                          >
                            {(deal) => (
                              <article
                                data-pipeline-company={deal.companyId}
                                data-transferring={
                                  transfer()?.id === deal.companyId
                                }
                                draggable
                                onDragStart={(event) =>
                                  event.dataTransfer?.setData(
                                    'text/plain',
                                    deal.companyId
                                  )
                                }
                              >
                                <div class="homepage-pipeline-card-header">
                                  <span
                                    class="homepage-pipeline-grip"
                                    title={`Drag ${company(deal.companyId).name}`}
                                  >
                                    <Grip class="size-4" />
                                  </span>
                                  <button
                                    class="homepage-pipeline-company"
                                    onClick={() => openCompany(deal.companyId)}
                                  >
                                    <Building class="size-4" />
                                    <span>{company(deal.companyId).name}</span>
                                  </button>
                                  <Dropdown modal={false}>
                                    <Dropdown.Trigger
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`Move ${company(deal.companyId).name}`}
                                      class="homepage-pipeline-actions"
                                    >
                                      <Dots class="size-4" />
                                    </Dropdown.Trigger>
                                    <Dropdown.Content portalScope="local">
                                      <Dropdown.Group>
                                        <Dropdown.GroupLabel>
                                          Move to
                                        </Dropdown.GroupLabel>
                                        <For each={stages()}>
                                          {(destination) => (
                                            <Dropdown.Item
                                              disabled={
                                                destination === deal.stage
                                              }
                                              onSelect={() =>
                                                setDeals(
                                                  (entry) =>
                                                    matchesDeal(
                                                      entry,
                                                      deal.companyId
                                                    ),
                                                  'stage',
                                                  destination
                                                )
                                              }
                                            >
                                              <StageIcon stage={destination} />
                                              {destination}
                                            </Dropdown.Item>
                                          )}
                                        </For>
                                      </Dropdown.Group>
                                    </Dropdown.Content>
                                  </Dropdown>
                                </div>
                                <div class="homepage-pipeline-fields">
                                  <Show when={deal.owner}>
                                    <div
                                      class="homepage-pipeline-field"
                                      title="Owner"
                                    >
                                      <Users class="size-3.5" />
                                      {ownerCell(deal)}
                                    </div>
                                  </Show>
                                  <Show when={deal.revenue}>
                                    <span
                                      class="homepage-pipeline-revenue"
                                      title="Revenue"
                                    >
                                      <Currency class="size-3.5" />
                                      {Number(deal.revenue || 0).toLocaleString(
                                        'en-US'
                                      )}
                                    </span>
                                  </Show>
                                </div>
                              </article>
                            )}
                          </For>
                        </section>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </Show>
        </Show>
      </main>

      <Show when={transfer()}>
        {(card) => (
          <div
            class="landing-pipeline-transfer"
            style={{
              left: `${card().x}px`,
              top: `${card().y}px`,
              width: `${card().width}px`,
              '--transfer-x': `${card().dx}px`,
              '--transfer-y': `${card().dy}px`,
            }}
            aria-hidden="true"
          >
            <div class="homepage-pipeline-card-header">
              <span class="homepage-pipeline-grip">
                <Grip class="size-4" />
              </span>
              <span class="homepage-pipeline-company">
                <Building class="size-4" />
                <span>{card().name}</span>
              </span>
            </div>
            <div class="homepage-pipeline-fields">
              <Show when={card().owner || undefined}>
                {(owner) => (
                  <span class="homepage-pipeline-field">
                    <Users class="size-3.5" />
                    <img src={homepagePeople[owner()].photo} alt="" />
                    {homepagePeople[owner()].name}
                  </span>
                )}
              </Show>
              <Show when={card().revenue}>
                <span class="homepage-pipeline-revenue">
                  <Currency class="size-3.5" />
                  {Number(card().revenue).toLocaleString('en-US')}
                </span>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            class="crm-hero-pointer"
            style={{
              transform: `translate(${point().x}px, ${point().y}px)`,
              transition: transfer() ? 'none' : undefined,
            }}
          />
        )}
      </Show>
      <DocumentShareSheet
        open={share()}
        title={pipelineName()}
        entityLabel="pipeline"
        onClose={() => setShare(false)}
      />
    </div>
  );
}
