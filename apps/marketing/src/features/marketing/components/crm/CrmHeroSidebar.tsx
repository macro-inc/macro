import Building from '@phosphor/buildings.svg';
import CaretDown from '@phosphor/caret-down.svg';
import List from '@phosphor/list-bullets.svg';
import Table from '@phosphor/table.svg';
import Users from '@phosphor/users.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { ViewSidebar } from '../DemoViewSidebar';
import { crmHeroLists, crmHeroPipelines } from './crm-hero-data';
import './crm-hero.css';

/** Presentation from CRM's sidebar and CollapsibleSection at 682c2654. */
function Section(props: { title: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(true);
  return (
    <section class="crm-hero-nav-section">
      <button
        class="crm-hero-section-trigger"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {props.title}
        <CaretDown class="size-2.5" />
      </button>
      <Show when={open()}>{props.children}</Show>
    </section>
  );
}

export function CrmHeroSidebar(props: {
  tab: string;
  pipelineId: string;
  onNavigate: (tab: string) => void;
  onPipeline: (id: string) => void;
}) {
  return (
    <ViewSidebar.Root aria-label="CRM navigation">
      <ViewSidebar.Header>
        <ViewSidebar.Title>Customers</ViewSidebar.Title>
      </ViewSidebar.Header>
      <ViewSidebar.Content>
        <Section title="Records">
          <ViewSidebar.Nav aria-label="CRM records">
            <ViewSidebar.Item
              active={props.tab === 'companies'}
              onClick={() => props.onNavigate('companies')}
            >
              <ViewSidebar.Icon>
                <Building />
              </ViewSidebar.Icon>
              Companies
            </ViewSidebar.Item>
            <ViewSidebar.Item
              active={props.tab === 'contacts'}
              onClick={() => props.onNavigate('contacts')}
            >
              <ViewSidebar.Icon>
                <Users />
              </ViewSidebar.Icon>
              Contacts
            </ViewSidebar.Item>
          </ViewSidebar.Nav>
        </Section>
        <Section title="Pipelines">
          <ViewSidebar.Nav aria-label="CRM pipelines">
            <For each={crmHeroPipelines}>
              {(pipeline) => (
                <ViewSidebar.Item
                  title={pipeline.name}
                  active={
                    props.tab === 'pipeline' && props.pipelineId === pipeline.id
                  }
                  onClick={() => props.onPipeline(pipeline.id)}
                >
                  <ViewSidebar.Icon>
                    <Table />
                  </ViewSidebar.Icon>
                  <span class="min-w-0 flex-1 truncate">{pipeline.name}</span>
                  <span class="text-xs text-ink-extra-muted">
                    {pipeline.sharing}
                  </span>
                </ViewSidebar.Item>
              )}
            </For>
          </ViewSidebar.Nav>
        </Section>
        <Section title="Lists">
          <ViewSidebar.Nav aria-label="Company lists">
            <For each={crmHeroLists}>
              {(list) => (
                <ViewSidebar.Item
                  title={list.name}
                  active={props.tab === `list:${list.id}`}
                  onClick={() => props.onNavigate(`list:${list.id}`)}
                >
                  <ViewSidebar.Icon>
                    <List />
                  </ViewSidebar.Icon>
                  <span class="min-w-0 flex-1 truncate">{list.name}</span>
                  <span class="text-xs tabular-nums text-ink-extra-muted">
                    {list.companyIds.length}
                  </span>
                </ViewSidebar.Item>
              )}
            </For>
          </ViewSidebar.Nav>
        </Section>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
