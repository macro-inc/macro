import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  SplitRouter,
  type SplitRouter as SplitRouterInstance,
  type SplitRoutes,
} from '@app/lib/split-router';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  companiesRoute,
  crmItemRoute,
  crmPipelineItemRoute,
  crmPipelineRecordItemRoute,
  crmPipelineRecordRoute,
  crmPipelineRoute,
  crmRecordItemRoute,
  crmRecordRoute,
} from '@app/routes/routes';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmRoute } from './context/workspace-context';
import { createCrmRoute } from './route-adapter';

vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: vi.fn(() => ({ type: 'mock-component' })),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

afterEach(cleanup);

let route: CrmRoute;
let capture = vi.fn();

function Customers() {
  route = createCrmRoute(capture);
  return (
    <>
      <p data-testid="customers">
        {`tab:${route.tab()} section:${route.section() ?? '-'} records:${route
          .records()
          .map((record) => `${record.type}:${record.id}:${record.name}`)
          .join(',')}`}
      </p>
      <p data-testid="item">{route.item()?.name ?? '-'}</p>
      <p data-testid="comment">{route.commentTarget()?.commentId ?? '-'}</p>
    </>
  );
}

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        {
          ...companiesRoute,
          component: Customers,
          children: [
            {
              ...crmPipelineRoute,
              children: [
                crmPipelineItemRoute,
                {
                  ...crmPipelineRecordRoute,
                  children: [crmPipelineRecordItemRoute],
                },
              ],
            },
            crmItemRoute,
            { ...crmRecordRoute, children: [crmRecordItemRoute] },
          ],
        },
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: companiesRoute.id, params: {} }),
};

function renderCustomers(url: string) {
  capture = vi.fn();
  const history = createMemoryHistory(url);
  let router: SplitRouterInstance | undefined;
  render(() => {
    const created = createSplitRouter({
      routes,
      history,
      paneStore: createMemoryPaneStore(),
      policy: createTestPolicy().policy,
    });
    router = created;
    onCleanup(() => created.dispose());
    return (
      <SplitRouter.Root router={created}>
        <For each={created.panes()}>
          {(pane) => <SplitRouter.Outlet pane={pane} />}
        </For>
      </SplitRouter.Root>
    );
  });
  const pane = () => router!.panes()[0]!;
  return {
    url: () => {
      const location = history.read();
      return `${location.path}${location.search ?? ''}`;
    },
    shows: (text: string) =>
      vi.waitFor(() =>
        expect(screen.getByTestId('customers').textContent).toBe(text)
      ),
    canGo: (delta: number) => router!.canGo(pane(), delta),
    go: (delta: number) => router!.navigatePane(pane(), delta),
  };
}

const acme = { type: 'company' as const, id: 'acme', name: 'Acme' };
const maya = { type: 'contact' as const, id: 'maya', name: 'Maya' };

it('opens a People contact at its own URL and returns to the list entry', async () => {
  const { url, shows, canGo } = renderCustomers('/companies?s0.crm.tab=people');
  await shows('tab:people section:- records:');

  route.open([maya]);
  await shows('tab:people section:- records:contact:maya:Maya');
  expect(url()).toBe('/companies/contact/maya?s0.crm.tab=people');

  route.close();
  await shows('tab:people section:- records:');
  expect(url()).toBe('/companies?s0.crm.tab=people');
  // It went back to the list's entry rather than adding one.
  expect(canGo(-1)).toBe(false);
  expect(canGo(1)).toBe(true);
});

it('keeps the trail with each record and its tab in the path', async () => {
  const { url, shows } = renderCustomers('/companies');
  route.open([acme]);
  await shows('tab:active section:- records:company:acme:Acme');

  route.open([acme, maya]);
  await shows(
    'tab:active section:- records:company:acme:Acme,contact:maya:Maya'
  );
  expect(url()).toBe('/companies/contact/maya');

  route.setSection('emails');
  await shows(
    'tab:active section:emails records:company:acme:Acme,contact:maya:Maya'
  );
  expect(url()).toBe('/companies/contact/maya/emails');

  route.setSection('overview');
  await shows(
    'tab:active section:- records:company:acme:Acme,contact:maya:Maya'
  );
  expect(url()).toBe('/companies/contact/maya');
});

it('shows a record link on its own, without a trail', async () => {
  const { url, shows, canGo } = renderCustomers('/companies/company/acme/team');
  await shows('tab:active section:team records:company:acme:');

  // No list entry precedes it, so the list opens as a new entry.
  route.close();
  await shows('tab:active section:- records:');
  expect(url()).toBe('/companies');
  expect(canGo(-1)).toBe(true);
});

it('opens pipelines and their records under the pipeline path', async () => {
  const { url, shows } = renderCustomers('/companies');
  route.setTab('pipeline:sales');
  await shows('tab:pipeline:sales section:- records:');
  expect(url()).toBe('/companies/pipeline/sales');

  route.open([acme]);
  await shows('tab:pipeline:sales section:- records:company:acme:Acme');
  expect(url()).toBe('/companies/pipeline/sales/company/acme');

  route.close();
  await shows('tab:pipeline:sales section:- records:');
  expect(url()).toBe('/companies/pipeline/sales');

  route.setTab('people');
  await shows('tab:people section:- records:');
  expect(url()).toBe('/companies?s0.crm.tab=people');
});

it('shows another list in place of an open record', async () => {
  const { url, shows, go } = renderCustomers('/companies');
  route.open([acme]);
  await shows('tab:active section:- records:company:acme:Acme');

  route.setTab('people');
  await shows('tab:people section:- records:');
  expect(url()).toBe('/companies?s0.crm.tab=people');

  // Back returns to the record, with its trail.
  await go(-1);
  await shows('tab:active section:- records:company:acme:Acme');
  expect(url()).toBe('/companies/company/acme');
});

it('shows a linked Discussion message only on the record it was asked for', async () => {
  const { url, shows } = renderCustomers(
    '/companies/company/acme?s0.crm-record.commentId=m1&s0.crm-record.seek=s1'
  );
  await shows('tab:active section:- records:company:acme:');
  expect(screen.getByTestId('comment').textContent).toBe('m1');

  route.open([acme, maya]);
  await shows(
    'tab:active section:- records:company:acme:Acme,contact:maya:Maya'
  );
  expect(screen.getByTestId('comment').textContent).toBe('-');
  expect(url()).toBe('/companies/contact/maya');
});

it('keeps an activity item in its source list across close and forward', async () => {
  const { url, shows, canGo, go } = renderCustomers(
    '/companies?s0.crm.tab=tasks'
  );
  await shows('tab:tasks section:- records:');
  expect(
    route.openItem({
      type: 'document',
      id: 'task-1',
      name: 'Follow up',
      fileType: 'md',
      subType: { type: 'task' },
    })
  ).toBe(true);
  await vi.waitFor(() =>
    expect(screen.getByTestId('item').textContent).toBe('Follow up')
  );
  expect(url()).toBe(
    '/companies/item/document/task-1/md/task?s0.crm.tab=tasks'
  );
  route.closeItem();
  await vi.waitFor(() =>
    expect(screen.getByTestId('item').textContent).toBe('-')
  );
  expect(url()).toBe('/companies?s0.crm.tab=tasks');
  expect(canGo(-1)).toBe(false);
  expect(canGo(1)).toBe(true);
  await go(1);
  await vi.waitFor(() =>
    expect(screen.getByTestId('item').textContent).toBe('Follow up')
  );
});

it('retains a record trail, section and pipeline source for an item', async () => {
  const { url, shows, go } = renderCustomers('/companies/pipeline/sales');
  await shows('tab:pipeline:sales section:- records:');
  route.open([acme, maya]);
  await shows(
    'tab:pipeline:sales section:- records:company:acme:Acme,contact:maya:Maya'
  );
  route.setSection('emails');
  await shows(
    'tab:pipeline:sales section:emails records:company:acme:Acme,contact:maya:Maya'
  );
  route.openItem({
    type: 'document',
    id: 'note-1',
    name: 'Note',
    fileType: 'md',
    subType: { type: 'task' },
  });
  await vi.waitFor(() =>
    expect(screen.getByTestId('item').textContent).toBe('Note')
  );
  expect(url()).toBe(
    '/companies/pipeline/sales/contact/maya/emails/item/document/note-1/md/task'
  );
  await shows(
    'tab:pipeline:sales section:emails records:company:acme:Acme,contact:maya:Maya'
  );
  route.closeItem();
  await vi.waitFor(() =>
    expect(screen.getByTestId('item').textContent).toBe('-')
  );
  expect(url()).toBe('/companies/pipeline/sales/contact/maya/emails');
  await go(1);
  await vi.waitFor(() =>
    expect(screen.getByTestId('item').textContent).toBe('Note')
  );
});

it('closes a directly loaded item to its record section without a prior entry', async () => {
  const { url, shows, canGo } = renderCustomers(
    '/companies/company/acme/emails/item/email/thread-1'
  );
  await shows('tab:active section:emails records:company:acme:');
  expect(route.item()?.itemId).toBe('thread-1');
  route.closeItem();
  await shows('tab:active section:emails records:company:acme:');
  await vi.waitFor(() => expect(route.item()).toBeUndefined());
  expect(url()).toBe('/companies/company/acme/emails');
  expect(canGo(-1)).toBe(true);
});

it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])(
  'leaves %s item opens to the split navigation handler',
  async (modifier) => {
    const { shows, canGo } = renderCustomers('/companies?s0.crm.tab=tasks');
    await shows('tab:tasks section:- records:');
    expect(
      route.openItem(
        { type: 'document', id: 'task-1', name: 'Follow up', fileType: 'md' },
        new MouseEvent('click', { [modifier]: true })
      )
    ).toBe(false);
    expect(route.item()).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
    expect(canGo(-1)).toBe(false);
  }
);

it('returns to the activity list when its sidebar destination is selected again', async () => {
  const { url, shows, canGo } = renderCustomers('/companies?s0.crm.tab=notes');
  await shows('tab:notes section:- records:');
  route.openItem({
    type: 'document',
    id: 'note-1',
    name: 'Note',
    fileType: 'md',
  });
  await vi.waitFor(() => expect(route.item()).toBeDefined());
  route.close();
  await vi.waitFor(() => expect(route.item()).toBeUndefined());
  expect(url()).toBe('/companies?s0.crm.tab=notes');
  expect(canGo(-1)).toBe(false);
});
