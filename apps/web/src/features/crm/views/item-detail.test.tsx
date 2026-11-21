import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmRecordRef, CrmTaskRecord } from '../core/record';

const fixture = vi.hoisted(() => ({
  allowed: (): boolean => true,
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
        item: () => ({
          itemType: 'email',
          itemId: 'thread-1',
          name: 'Individually shared item',
        }),
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
  SidePanel: { Root: (props: ParentProps) => <>{props.children}</> },
}));
vi.mock('@app/components/entity-detail/EntityDetail', () => ({
  entityDetailBlockType: () => undefined,
  EntityDetail: (props: {
    previewHeaderLeading: JSX.Element;
    target: { fallbackName: string };
  }) => (
    <>
      {props.previewHeaderLeading}
      <p>{props.target.fallbackName}</p>
    </>
  ),
}));
vi.mock('@app/features/drive-view/MarkdownDetail', () => ({
  MarkdownDetail: () => null,
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

afterEach(cleanup);

it('retires CRM breadcrumbs and task presets while an independently shared item stays open', () => {
  const [allowed, setAllowed] = createSignal(true);
  fixture.allowed = allowed;
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
