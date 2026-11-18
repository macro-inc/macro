import type { EntityDetailTarget } from '@app/components/entity-detail/entity-detail-target';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriveLocation } from './core/types';
import type { DriveRouteParams } from './primitives/drive-route';

const [params, setParams] = createSignal<DriveRouteParams>({});
const [routeState, setRouteState] = createSignal<unknown>();
const navigate = vi.fn(
  async (
    destination: { params: DriveRouteParams },
    options?: { state?: unknown }
  ) => {
    setParams(destination.params);
    setRouteState(options?.state);
  }
);

vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useNavigate: () => navigate,
  useParams: () =>
    new Proxy({}, { get: (_, key) => params()[key as keyof DriveRouteParams] }),
  useRouteState: () => routeState,
}));
vi.mock('@app/routes/routes', () => ({
  driveFolderDocumentRoute: { id: 'drive-folder-document' },
  driveFolderRoute: { id: 'drive-folder' },
  driveRootDocumentRoute: { id: 'drive-document' },
  driveSplitRoute: { id: 'drive' },
  driveTabDocumentRoute: { id: 'drive-tab-document' },
  driveTabRoute: { id: 'drive-tab' },
}));
vi.mock('@app/components/entity-detail/EntityDetail', () => ({
  entityDetailBlockType: (target: { fileType?: string }) => target.fileType,
}));
vi.mock('@app/components/view-shell/use-inline-preview-layout', () => ({
  useInlinePreviewLayout: () => () => true,
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () => () => true,
}));

import {
  DriveDetailNavigationProvider,
  useDriveDetailNavigation,
} from './drive-detail-navigation';

const MY_FILES: DriveLocation = { kind: 'tab', tab: 'owned' };

const pdf = (id: string): EntityDetailTarget => ({
  type: 'document',
  id,
  fileType: 'pdf',
});

function mountDrive(location: DriveLocation = MY_FILES) {
  let navigation!: ReturnType<typeof useDriveDetailNavigation>;
  const Capture = () => {
    navigation = useDriveDetailNavigation();
    return null;
  };
  render(() => (
    <DriveDetailNavigationProvider location={() => location}>
      <Capture />
    </DriveDetailNavigationProvider>
  ));
  return navigation;
}

beforeEach(() => {
  setParams({});
  setRouteState(undefined);
  navigate.mockClear();
});
afterEach(cleanup);

describe('the Drive location a detail names', () => {
  it('names the list on screen while no detail is open', () => {
    const navigation = mountDrive();

    expect(navigation.showsLocation()).toBe(true);
  });

  it('names the list a document was opened from', () => {
    const navigation = mountDrive({ kind: 'folder', id: 'folder-1' });

    navigation.openRoot(pdf('report'));

    expect(params()).toMatchObject({ folderId: 'folder-1' });
    expect(navigation.active()?.data.id).toBe('report');
    expect(navigation.showsLocation()).toBe(true);
  });

  it('names no location for a document opened outside Drive', () => {
    setParams({ documentId: 'attachment', documentType: 'pdf' });
    const navigation = mountDrive();

    expect(navigation.active()?.data.id).toBe('attachment');
    expect(navigation.showsLocation()).toBe(false);
  });

  it('names no location for a document opened from one opened outside Drive', () => {
    setParams({ documentId: 'attachment', documentType: 'pdf' });
    const navigation = mountDrive();

    navigation.navigate(pdf('copy'));

    expect(navigation.entries().map((entry) => entry.data.id)).toEqual([
      'attachment',
      'copy',
    ]);
    expect(navigation.showsLocation()).toBe(false);
  });

  it('keeps the list location through documents opened from its detail', () => {
    const navigation = mountDrive();
    navigation.openRoot(pdf('report'));

    navigation.navigate(pdf('appendix'));

    expect(navigation.active()?.data.id).toBe('appendix');
    expect(navigation.showsLocation()).toBe(true);
  });

  it('names no location for a favorite opened at My Files from a folder', () => {
    const navigation = mountDrive({ kind: 'folder', id: 'folder-1' });

    navigation.openRoot(pdf('shared-favorite'), { location: MY_FILES });

    expect(params()).not.toHaveProperty('folderId');
    expect(navigation.showsLocation()).toBe(false);
  });
});
