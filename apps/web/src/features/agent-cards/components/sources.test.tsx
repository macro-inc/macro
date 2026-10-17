/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  openUrl: vi.fn(),
  access: 'access' as 'access' | 'no_access',
}));

vi.mock('@core/component/ItemPreview', () => ({
  useItemPreviewData: (entity: () => { id: string }) => ({
    item: () =>
      mocks.access === 'access'
        ? {
            loading: false,
            access: 'access',
            id: entity().id,
            type: 'document',
            name: 'Pricing review notes',
            fileType: 'md',
          }
        : { loading: false, access: 'no_access', id: entity().id },
    name: () => 'Pricing review notes',
    targetType: () => 'md',
    onPreviewClick: mocks.open,
  }),
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <i data-icon={props.targetType} />
  ),
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: mocks.openUrl }));
vi.mock('@queries/unfurl/resource', () => ({
  proxiedResourceUrl: (url: string) => `/proxy?url=${url}`,
}));

import { type SourceRef, Sources, siteOf } from './sources';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.access = 'access';
});

const SOURCES: SourceRef[] = [
  {
    kind: 'web',
    url: 'https://www.lumen.example/blog/pricing',
    title: 'Lumen raises prices',
  },
  { kind: 'item', itemType: 'document', itemId: 'doc-1' },
];

describe('sources', () => {
  it('fold to a pill that says how many there are', () => {
    const view = render(() => (
      <Sources queries={['lumen pricing']} sources={SOURCES} total={7} />
    ));
    expect(view.getByRole('button', { name: 'Show 7 sources' })).toBeTruthy();
    expect(view.queryByText('Lumen raises prices')).toBeNull();
  });

  it('open into the pages and items, each opening where it lives', () => {
    const view = render(() => (
      <Sources queries={['lumen pricing']} sources={SOURCES} total={7} />
    ));
    fireEvent.click(view.getByRole('button', { name: 'Show 7 sources' }));
    expect(view.getByText('2 of 7 · Searched “lumen pricing”')).toBeTruthy();
    expect(view.getByText('lumen.example')).toBeTruthy();
    fireEvent.click(view.getByText('Lumen raises prices'));
    expect(mocks.openUrl).toHaveBeenCalledWith(
      'https://www.lumen.example/blog/pricing'
    );
    fireEvent.click(view.getByText('Pricing review notes'));
    expect(mocks.open).toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Hide sources' }));
    expect(view.getByRole('button', { name: 'Show 7 sources' })).toBeTruthy();
  });

  it('never name an item the viewer cannot open', () => {
    mocks.access = 'no_access';
    const view = render(() => (
      <Sources queries={[]} sources={SOURCES} total={2} />
    ));
    fireEvent.click(view.getByRole('button', { name: 'Show 2 sources' }));
    expect(view.queryByText('Pricing review notes')).toBeNull();
    expect(view.getByText("Document you can't open")).toBeTruthy();
  });

  it('name a page by its site', () => {
    expect(siteOf('https://www.theverge.com/2026/10/x')).toBe('theverge.com');
    expect(siteOf('not a url')).toBe('not a url');
  });
});
