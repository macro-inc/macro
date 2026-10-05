/**
 * Team libraries in the viewer: the Assets panel's Libraries button (with
 * the Libraries and Publish dialogs), the sections listing each enabled
 * library's assets, and the update notice with its review dialog.
 */

import type { PublishedAsset } from '@core/fig-engine/library-types';
import ArrowsClockwise from '@phosphor/arrows-clockwise.svg';
import BookOpen from '@phosphor/book-open.svg';
import { createSignal, For, Show } from 'solid-js';
import { LibrariesDialog } from '../components/libraries-dialog';
import { LibraryAssets } from '../components/library-assets';
import {
  LibraryUpdatesDialog,
  LibraryUpdatesNotice,
} from '../components/library-updates';
import { PublishDialog } from '../components/publish-dialog';
import { groupAssets, type LibraryUpdate } from '../core/libraries';
import type { FigLibraries } from '../primitives/create-fig-libraries';

/** The Libraries button and update count for the Assets panel's header. */
export function LibrariesButton(props: {
  libraries: FigLibraries;
  fileName: string;
}) {
  const libs = props.libraries;
  const [open, setOpen] = createSignal(false);
  const [publishing, setPublishing] = createSignal<'open' | 'busy'>();
  const openDialog = () => {
    setOpen(true);
    void libs.refresh();
  };
  const publish = async (note: string) => {
    setPublishing('busy');
    const done = await libs.publish(note);
    setPublishing(undefined);
    // Published, both dialogs close (as Figma's do); a failure goes back.
    if (done) setOpen(false);
  };
  return (
    <>
      <Show when={libs.updates().length > 0}>
        <button
          type="button"
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-hover"
          data-testid="fig-assets-updates"
          title="Review library updates"
          onClick={() => libs.setReviewing(true)}
        >
          <ArrowsClockwise class="size-3.5" />
          {libs.updates().length}
        </button>
      </Show>
      <button
        type="button"
        aria-label="Libraries"
        title="Libraries"
        class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
        data-testid="fig-assets-libraries"
        onClick={openDialog}
      >
        <BookOpen class="size-3.5" />
      </button>
      <Show when={open() && !publishing()}>
        <LibrariesDialog
          fileName={props.fileName}
          status={libs.status()}
          documents={libs.documents()?.filter((d) => d.id !== libs.documentId)}
          enabled={libs.uses().enabled}
          loaded={libs.loaded()}
          canEdit={libs.canEdit()}
          onToggle={(library, on) => void libs.setEnabled(library, on)}
          onPublish={() => setPublishing('open')}
          onClose={() => setOpen(false)}
        />
      </Show>
      <Show when={publishing() && libs.status()}>
        {(status) => (
          <PublishDialog
            status={status()}
            publishing={publishing() === 'busy'}
            onPublish={(note) => void publish(note)}
            onClose={() => setPublishing(undefined)}
          />
        )}
      </Show>
    </>
  );
}

/** Each enabled library's assets matching `query`. */
export function LibrarySections(props: {
  libraries: FigLibraries;
  query: string;
  hasSelection: boolean;
}) {
  const libs = props.libraries;
  const apply = (library: string, a: PublishedAsset) =>
    a.kind === 'VARIABLE'
      ? libs.bindVariable(library, a)
      : libs.applyStyle(library, a);
  return (
    <For each={libs.uses().enabled}>
      {(library) => {
        const state = () => libs.loaded().get(library.id);
        const groups = () => {
          const s = state();
          return s?.state === 'ready'
            ? groupAssets(s.published, props.query)
            : undefined;
        };
        const failed = () => {
          const s = state();
          return s?.state === 'failed' ? s.message : undefined;
        };
        return (
          <LibraryAssets
            library={library.id}
            name={library.name}
            groups={groups()}
            failed={failed()}
            canEdit={libs.canEdit()}
            hasSelection={props.hasSelection}
            thumbnail={(a) => libs.assetThumbnail(library.id, a.id)}
            onInsert={(a) => void libs.insertComponent(library.id, a)}
            onApply={(a) => void apply(library.id, a)}
          />
        );
      }}
    </For>
  );
}

/** "Library updates available", and the review dialog it opens. */
export function LibraryUpdates(props: { libraries: FigLibraries }) {
  const libs = props.libraries;
  const notes = (library: string) =>
    libs.published().get(library)?.note ?? null;
  const update = async (list: readonly LibraryUpdate[]) => {
    await libs.update(list);
    if (libs.updates().length === 0) libs.setReviewing(false);
  };
  return (
    <>
      <Show when={libs.updates().length > 0 && !libs.reviewing()}>
        <LibraryUpdatesNotice
          updates={libs.updates()}
          onReview={() => libs.setReviewing(true)}
        />
      </Show>
      <Show when={libs.reviewing()}>
        <LibraryUpdatesDialog
          updates={libs.updates()}
          notes={notes}
          canEdit={libs.canEdit()}
          updating={libs.updating()}
          before={(u) => libs.copyThumbnail(u.copyId)}
          after={(u) => libs.assetThumbnail(u.library, u.assetId)}
          onUpdate={(list) => void update(list)}
          onClose={() => libs.setReviewing(false)}
        />
      </Show>
    </>
  );
}
