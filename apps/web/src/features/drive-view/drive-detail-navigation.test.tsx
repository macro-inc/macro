import type { EntityDetailTarget } from '@app/components/entity-detail/entity-detail-target';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { driveDetailTrailSchema } from './primitives/drive-detail-trail';
import {
  type DriveRouteParams,
  driveLocationFromParams,
} from './primitives/drive-route';

const [params, setParams] = createSignal<DriveRouteParams>({});
const [routeState, setRouteState] = createSignal<unknown>();
// The router keeps only what the route's state schema accepts.
const navigate = vi.fn(
  async (
    destination: { params: DriveRouteParams },
    options?: { state?: unknown }
  ) => {
    setParams(destination.params);
    setRouteState(
      options?.state === undefined
        ? undefined
        : driveDetailTrailSchema.parse(options.state)
    );
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

const FOLDER: DriveRouteParams = { view: 'folder', folderId: 'folder-1' };

const pdf = (id: string): EntityDetailTarget => ({
  type: 'document',
  id,
  fileType: 'pdf',
});

function mountDrive(route: DriveRouteParams = {}) {
  setParams(route);
  let navigation!: ReturnType<typeof useDriveDetailNavigation>;
  const Capture = () => {
    navigation = useDriveDetailNavigation();
    return null;
  };
  render(() => (
    <DriveDetailNavigationProvider
      location={() => driveLocationFromParams(params())}
    >
      <Capture />
    </DriveDetailNavigationProvider>
  ));
  return navigation;
}

beforeEach(() => {
  setRouteState(undefined);
  navigate.mockClear();
});
afterEach(cleanup);

describe('the Drive location a detail names', () => {
  it('names the list on screen while no detail is open', () => {
    const navigation = mountDrive();

    expect(navigation.showsLocation()).toBe(true);
  });

  it('names My Files for a document opened from it', () => {
    const navigation = mountDrive();

    navigation.openRoot(pdf('report'));

    expect(navigation.active()?.data.id).toBe('report');
    expect(navigation.showsLocation()).toBe(true);
  });

  it('names no location for a document opened outside Drive', () => {
    const navigation = mountDrive({
      documentId: 'attachment',
      documentType: 'pdf',
    });

    expect(navigation.active()?.data.id).toBe('attachment');
    expect(navigation.showsLocation()).toBe(false);
  });

  it('names no location for a document opened from one opened outside Drive', () => {
    const navigation = mountDrive({
      documentId: 'attachment',
      documentType: 'pdf',
    });

    navigation.navigate(pdf('copy'));

    expect(navigation.entries().map((entry) => entry.data.id)).toEqual([
      'attachment',
      'copy',
    ]);
    expect(navigation.showsLocation()).toBe(false);
  });

  it('keeps My Files through documents opened from its detail and back', () => {
    const navigation = mountDrive();
    navigation.openRoot(pdf('report'));
    navigation.navigate(pdf('appendix'));

    expect(navigation.showsLocation()).toBe(true);

    navigation.popTo(navigation.entries()[0]!.value);

    expect(navigation.active()?.data.id).toBe('report');
    expect(navigation.showsLocation()).toBe(true);
  });

  it('names the folder of a folder document restored from its URL alone', () => {
    const navigation = mountDrive({
      ...FOLDER,
      documentId: 'report',
      documentType: 'pdf',
    });

    expect(navigation.showsLocation()).toBe(true);
  });

  it('opens a sidebar shortcut at My Files with no location', () => {
    const navigation = mountDrive(FOLDER);

    navigation.openRoot(pdf('shared-favorite'), { shortcut: true });

    expect(params()).not.toHaveProperty('folderId');
    expect(navigation.active()?.data.id).toBe('shared-favorite');
    expect(navigation.showsLocation()).toBe(false);
  });

  it('opens an item at the list that holds it', () => {
    const navigation = mountDrive({ tab: 'shared' });

    navigation.openRoot(pdf('new-document'), {
      location: { kind: 'tab', tab: 'owned' },
    });

    expect(params()).not.toHaveProperty('tab');
    expect(navigation.showsLocation()).toBe(true);
  });

  it('names no location for a call, which Drive never lists', () => {
    const navigation = mountDrive({ callId: 'call-1' } as DriveRouteParams);

    expect(navigation.showsLocation()).toBe(false);
  });
});
