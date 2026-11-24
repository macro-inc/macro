import type * as EntityDetailModule from '@app/components/entity-detail/EntityDetail';
import { useSplitHeaderScope } from '@components/app/SplitHeaderScope';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmRecordRef, CrmTaskRecord } from '../core/record';
import type { CrmItemParams } from '../crm-route';

const fixture = vi.hoisted(() => ({
  allowed: (): boolean => true,
  touch: false,
  item: undefined as (CrmItemParams & { name: string }) | undefined,
  record: undefined as (() => CrmTaskRecord | undefined) | undefined,
  records: [
    { type: 'company', id: 'company-1', name: 'Private company' },
    { type: 'contact', id: 'contact-1', name: 'Private contact' },
  ] as CrmRecordRef[],
}));

vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    canAccess: () => fixture.allowed(),
    registerTaskComposerRecord: (source: () => CrmTaskRecord | undefined) => {
      fixture.record = source;
      return () => {
        fixture.record = undefined;
      };
    },
  }),
}));
vi.mock('../context/workspace-context', () => ({
  useCrmWorkspace: () => ({
    host: {
      record: {
        records: () => fixture.records,
        item: () => fixture.item,
        close: vi.fn(),
        closeItem: vi.fn(),
        open: vi.fn(),
      },
    },
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({}),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Root: (props: ParentProps) => <>{props.children}</>,
    HeaderActionsOutlet: () => null,
    Toggle: () => null,
  },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => fixture.touch,
}));
vi.mock(
  '@app/components/priority-collapse/PriorityCollapseOverflowSensor',
  () => ({
    createPriorityCollapseController: () => ({
      setRow: () => {},
      collapser: {},
    }),
    PriorityCollapseOverflowSensor: () => null,
  })
);
vi.mock(
  '@app/components/entity-detail/EntityDetail',
  async (importOriginal) => ({
    ...(await importOriginal<typeof EntityDetailModule>()),
    EntityDetail: (props: {
      previewHeaderLeading: JSX.Element;
      target: { id: string; fallbackName: string };
    }) => (
      <>
        {props.previewHeaderLeading}
        <p>{props.target.fallbackName}</p>
        <p>
          File viewer for {props.target.id} with{' '}
          {useSplitHeaderScope() ? 'its header in the pane' : 'the CRM bar'}
        </p>
      </>
    ),
  })
);
vi.mock('@app/features/drive-view/views/MarkdownDetail', () => ({
  MarkdownDetail: (props: { documentId: string }) => (
    <p>
      Markdown viewer for {props.documentId} with{' '}
      {useSplitHeaderScope() ? 'its header in the pane' : 'the CRM bar'}
    </p>
  ),
}));
vi.mock('@app/features/drive-view/views/FileDetailBreadcrumbItem', () => ({
  FileDetailBreadcrumbItem: () => null,
}));
vi.mock('@block-md/component/MarkdownDetailBreadcrumbItem', () => ({
  MarkdownDetailBreadcrumbItem: () => null,
}));
vi.mock('@core/component/TopBar/shareModal', () => ({
  useDocumentShareModal: () => vi.fn(),
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: () => null,
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('./record-detail', () => ({
  createRecordName: (record: CrmRecordRef) => () => record.name,
}));

import { CrmItemDetail } from './item-detail';

afterEach(() => {
  cleanup();
  fixture.allowed = () => true;
  fixture.touch = false;
});

it('retires CRM breadcrumbs and task presets while an independently shared item stays open', () => {
  const [allowed, setAllowed] = createSignal(true);
  fixture.allowed = allowed;
  fixture.item = {
    itemType: 'email',
    itemId: 'thread-1',
    name: 'Individually shared item',
  };
  render(() => <CrmItemDetail sourceName="Shared pipeline" />);
  expect(screen.getByText('Private company')).toBeTruthy();
  expect(screen.getByText('Private contact')).toBeTruthy();
  expect(fixture.record?.()).toMatchObject({
    type: 'contact',
    id: 'contact-1',
  });
  setAllowed(false);
  expect(screen.getByText('Individually shared item')).toBeTruthy();
  expect(screen.queryByText('Private company')).toBeNull();
  expect(screen.queryByText('Private contact')).toBeNull();
  expect(fixture.record?.()).toBeUndefined();
  setAllowed(true);
  expect(screen.getByText('Private contact')).toBeTruthy();
  expect(fixture.record?.()).toMatchObject({
    type: 'contact',
    id: 'contact-1',
  });
});

it.each([
  { itemFileType: 'pdf', name: 'contract.pdf' },
  { itemFileType: 'image', name: 'site-photo.jpg' },
])('opens a $itemFileType file from a record in its file viewer', (file) => {
  fixture.item = { itemType: 'document', itemId: 'file-1', ...file };
  render(() => (
    <SplitPanelContext.Provider value={{} as SplitPanelContextType}>
      <CrmItemDetail sourceName="People" />
    </SplitPanelContext.Provider>
  ));
  expect(
    screen.getByText('File viewer for file-1 with the CRM bar')
  ).toBeTruthy();
  expect(screen.queryByText(/Markdown viewer/)).toBeNull();
});

it('opens a file in its file viewer with its own header on touch', () => {
  fixture.touch = true;
  fixture.item = {
    itemType: 'document',
    itemId: 'file-1',
    itemFileType: 'pdf',
    name: 'contract.pdf',
  };
  render(() => (
    <SplitPanelContext.Provider value={{} as SplitPanelContextType}>
      <CrmItemDetail sourceName="People" />
    </SplitPanelContext.Provider>
  ));
  expect(
    screen.getByText('File viewer for file-1 with its header in the pane')
  ).toBeTruthy();
  expect(screen.queryByText(/Markdown viewer/)).toBeNull();
});

it('opens a note in the Markdown viewer with its own header on touch', () => {
  fixture.touch = true;
  fixture.item = {
    itemType: 'document',
    itemId: 'note-1',
    itemFileType: 'md',
    name: 'Call notes',
  };
  render(() => (
    <SplitPanelContext.Provider value={{} as SplitPanelContextType}>
      <CrmItemDetail sourceName="People" />
    </SplitPanelContext.Provider>
  ));
  expect(
    screen.getByText('Markdown viewer for note-1 with its header in the pane')
  ).toBeTruthy();
  expect(screen.queryByText(/File viewer/)).toBeNull();
});
