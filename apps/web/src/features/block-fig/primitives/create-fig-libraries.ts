/**
 * Team libraries in the editor: this file's publishing state, the
 * libraries it uses (each read in an engine of its own, from its stored
 * file), their published assets and thumbnails, the updates they offer,
 * and the actions the Assets panel and its dialogs take: publishing,
 * enabling libraries, inserting components, applying styles, binding
 * variables, and updating copies.
 *
 * Library files are read when the libraries are first needed and again on
 * `refresh` (opening the Libraries dialog), so what another person
 * published shows without reopening the design.
 */

import { FigEngine } from '@core/fig-engine/client';
import type {
  LibraryRef,
  LibraryStatus,
  LibraryUse,
  PublishedAsset,
  PublishedLibrary,
} from '@core/fig-engine/library-types';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import type { FigLibrarySource } from '../context/fig-libraries';
import {
  draggedAsset,
  type LibraryUpdate,
  type LoadedLibrary,
  libraryUpdates,
  styleKind,
  withLibrary,
} from '../core/libraries';
import type { FigEditor } from './create-fig-editor';
import type { FigViewer } from './create-fig-viewer';

const THUMBNAIL_SIZE = 96;
/** Designs read to find libraries, most recently viewed first. */
const PROBE_LIMIT = 20;

export function createFigLibraries(options: {
  engine: FigEngine;
  viewer: FigViewer;
  editor?: FigEditor;
  source: FigLibrarySource;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
}) {
  const { engine, viewer, source } = options;
  const [uses, setUses] = createSignal<LibraryUse>({ enabled: [], copies: [] });
  const [status, setStatus] = createSignal<LibraryStatus>();
  const [loaded, setLoaded] = createSignal<ReadonlyMap<string, LoadedLibrary>>(
    new Map()
  );
  /** Library engines by document id (closed with the editor). */
  const engines = new Map<string, FigEngine>();
  /** Libraries whose read under way should keep its engine. */
  const keepWanted = new Set<string>();
  const thumbnails = new Map<string, Promise<string | null>>();
  /** The update review dialog is open. */
  const [reviewing, setReviewing] = createSignal(false);
  const [updating, setUpdating] = createSignal(false);

  /**
   * The publishing state (which hashes every asset) is read only while
   * something shows it: the Libraries dialog.
   */
  const [watchingStatus, setWatchingStatus] = createSignal(false);
  let request = 0;
  const loadState = async () => {
    const mine = ++request;
    try {
      const [u, s] = await Promise.all([
        engine.libraryUses(),
        watchingStatus() ? engine.libraryStatus() : Promise.resolve(undefined),
      ]);
      if (mine !== request) return;
      setUses(u);
      if (s) setStatus(s);
    } catch {
      // A file that fails to answer keeps the last state.
    }
  };
  createEffect(on(viewer.editVersion, () => void loadState()));

  /** Starts (or stops) keeping the publishing state current. */
  const watchStatus = (on: boolean) => {
    setWatchingStatus(on);
    if (on) void loadState();
  };

  const setOne = (id: string, value: LoadedLibrary) =>
    setLoaded((m) => new Map(m).set(id, value));

  /**
   * Reads library `id` (again, with `force`) in an engine of its own, kept
   * open for using its assets when `keep` (an enabled library), else closed
   * once its published assets are known.
   */
  const load = async (id: string, opts: { force?: boolean; keep: boolean }) => {
    const current = loaded().get(id);
    if (current?.state === 'loading') {
      // The read under way keeps its engine when it is wanted.
      if (opts.keep) keepWanted.add(id);
      return;
    }
    const held = engines.has(id);
    if (
      current &&
      !opts.force &&
      current.state !== 'failed' &&
      (held || !opts.keep)
    )
      return;
    setOne(id, { state: 'loading' });
    try {
      const bytes = await source.load(id);
      const next = await FigEngine.open(bytes, { helpers: 0 });
      const published = await next.libraryAssets();
      engines.get(id)?.close();
      engines.delete(id);
      const keep =
        opts.keep ||
        keepWanted.has(id) ||
        uses().enabled.some((l) => l.id === id);
      keepWanted.delete(id);
      if (keep) engines.set(id, next);
      else next.close();
      for (const key of [...thumbnails.keys()]) {
        if (key.startsWith(`${id}/`)) thumbnails.delete(key);
      }
      setOne(id, { state: 'ready', published });
    } catch (e) {
      setOne(id, {
        state: 'failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  /**
   * Reads the designs not read yet, one at a time, to tell which publish a
   * library (the Libraries dialog lists them).
   */
  let probing = false;
  const probe = async () => {
    if (probing) return;
    probing = true;
    try {
      const docs = (source.documents() ?? [])
        .filter((d) => d.id !== source.documentId)
        .slice(0, PROBE_LIMIT);
      for (const d of docs) {
        if (!loaded().has(d.id)) await load(d.id, { keep: false });
      }
    } finally {
      probing = false;
    }
  };

  // The libraries the file uses are read once they are known (another
  // person enabling one shows here too).
  createEffect(
    on(
      () =>
        uses()
          .enabled.map((l) => l.id)
          .join('\n'),
      () => {
        for (const l of uses().enabled) void load(l.id, { keep: true });
      }
    )
  );

  onCleanup(() => {
    for (const e of engines.values()) e.close();
    engines.clear();
    for (const t of thumbnails.values())
      void t.then((url) => url && URL.revokeObjectURL(url));
  });

  /** The published assets of the libraries read so far, by id. */
  const published = (): ReadonlyMap<string, PublishedLibrary> => {
    const out = new Map<string, PublishedLibrary>();
    for (const [id, l] of loaded())
      if (l.state === 'ready') out.set(id, l.published);
    return out;
  };

  const updates = (): LibraryUpdate[] => libraryUpdates(uses(), published());

  /** Reads every library the file uses again. */
  const refresh = async () => {
    await Promise.all(
      uses().enabled.map((l) => load(l.id, { force: true, keep: true }))
    );
    await probe();
  };

  const run = (ops: Parameters<FigEditor['apply']>[0]) =>
    options.editor?.apply(ops) ?? Promise.resolve(undefined);

  /** "Publish library": every asset gets its current version. */
  const publish = async (note: string) => {
    const result = await run([
      { op: 'publishLibrary', seed: source.documentId, note },
    ]);
    if (result) options.notifyInfo('Library published');
    return result;
  };

  /** Turns a library on or off for this file (the Libraries dialog). */
  const setEnabled = async (library: LibraryRef, on: boolean) => {
    const libraries = withLibrary(uses().enabled, library, on);
    await run([{ op: 'setLibraries', libraries }]);
    if (on) await load(library.id, { force: true, keep: true });
  };

  const libraryEngine = (id: string) => {
    const e = engines.get(id);
    if (!e) throw new Error('The library is not available');
    return e;
  };

  /** Copies `asset` in (with what it uses), then applies `then`. */
  const bring = async (library: string, keys: string[], then: unknown[]) => {
    const editor = options.editor;
    if (!editor?.enabled()) return undefined;
    try {
      const pkg = await libraryEngine(library).libraryPackage(keys);
      return await editor.importLibrary(pkg, { library, then });
    } catch (e) {
      options.notifyError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  };

  /**
   * Places an instance of a library component: its top left at `at` in
   * `parent`, or centered in the view on the open page.
   */
  const insertComponent = async (
    library: string,
    asset: PublishedAsset,
    place?: { parent: string; x: number; y: number }
  ) => {
    const page = viewer.pages[viewer.page()];
    const editor = options.editor;
    if (!page || !editor) return undefined;
    const at =
      place ??
      (() => {
        const { x, y } = editor.viewCenter(asset.width, asset.height);
        return { parent: page.id, x, y };
      })();
    return bring(
      library,
      [asset.key],
      [{ op: 'instantiate', component: `key:${asset.key}`, ...at }]
    );
  };

  /** A component dragged from the Assets panel and dropped at `at`, centered there. */
  const dropAsset = (
    data: string,
    at: { x: number; y: number },
    parent: string
  ) => {
    const dragged = draggedAsset(data);
    const library = dragged && published().get(dragged.library);
    const asset = library?.assets.find((a) => a.key === dragged?.key);
    if (!dragged || !asset) return Promise.resolve(undefined);
    return insertComponent(dragged.library, asset, {
      parent,
      x: Math.round(at.x - asset.width / 2),
      y: Math.round(at.y - asset.height / 2),
    });
  };

  /** Applies a library style to the selected layers. */
  const applyStyle = (library: string, asset: PublishedAsset) => {
    const kind = styleKind(asset);
    const ids = options.editor?.editableIds() ?? [];
    if (!kind || ids.length === 0) return Promise.resolve(undefined);
    return bring(
      library,
      [asset.key],
      [{ op: 'applyStyle', ids, kind, style: `key:${asset.key}` }]
    );
  };

  /** Binds the selected layers' first fill to a library color variable. */
  const bindVariable = (library: string, asset: PublishedAsset) => {
    const ids = options.editor?.editableIds() ?? [];
    if (ids.length === 0) return Promise.resolve(undefined);
    return bring(
      library,
      [asset.key],
      [
        {
          op: 'bindVariable',
          ids,
          field: 'FILL',
          index: 0,
          variable: `key:${asset.key}`,
        },
      ]
    );
  };

  /** Replaces this file's copies with the libraries' published versions. */
  const update = async (list: readonly LibraryUpdate[]) => {
    const editor = options.editor;
    if (!editor?.enabled() || list.length === 0) return;
    setUpdating(true);
    const byLibrary = new Map<string, string[]>();
    for (const u of list)
      byLibrary.set(u.library, [...(byLibrary.get(u.library) ?? []), u.key]);
    let done = 0;
    for (const [library, keys] of byLibrary) {
      try {
        const pkg = await libraryEngine(library).libraryPackage(keys);
        const result = await editor.importLibrary(pkg, {
          library,
          update: true,
        });
        if (result) done += keys.length;
      } catch (e) {
        options.notifyError(e instanceof Error ? e.message : String(e));
      }
    }
    await loadState();
    setUpdating(false);
    if (done > 0)
      options.notifyInfo(
        done === 1 ? 'Updated 1 asset' : `Updated ${done} assets`
      );
  };

  /** An object URL of a PNG, rendered once per key. */
  const cached = (key: string, render: () => Promise<Blob | null>) => {
    let t = thumbnails.get(key);
    if (!t) {
      t = render()
        .then((blob) => (blob ? URL.createObjectURL(blob) : null))
        .catch(() => null);
      thumbnails.set(key, t);
    }
    return t;
  };

  /** A thumbnail of a library's asset. */
  const assetThumbnail = (library: string, assetId: string) =>
    cached(`${library}/${assetId}`, () =>
      libraryEngine(library).nodeThumbnail(assetId, THUMBNAIL_SIZE)
    );

  /** A thumbnail of this file's copy of an asset (as it is now). */
  const copyThumbnail = (copyId: string) =>
    engine
      .nodeThumbnail(copyId, THUMBNAIL_SIZE)
      .then((blob) => (blob ? URL.createObjectURL(blob) : null));

  return {
    uses,
    status,
    watchStatus,
    loaded,
    published,
    updates,
    documents: source.documents,
    documentId: source.documentId,
    refresh,
    publish,
    setEnabled,
    insertComponent,
    dropAsset,
    applyStyle,
    bindVariable,
    update,
    assetThumbnail,
    copyThumbnail,
    canEdit: () => options.editor?.enabled() ?? false,
    reviewing,
    setReviewing,
    updating,
  };
}

export type FigLibraries = ReturnType<typeof createFigLibraries>;
