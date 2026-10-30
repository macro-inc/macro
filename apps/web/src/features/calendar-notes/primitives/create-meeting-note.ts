import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { NotesSource } from '../context/notes-source';
import type { NoteCreateFailure, NoteDocument } from '../core/types';

/** Create once, retain a saved note if linking fails, and navigate after linking. */
export function createMeetingNoteAction(options: {
  source: NotesSource;
  title: Accessor<string>;
  onOpen: (document: NoteDocument) => void;
}) {
  const [pending, setPending] = createSignal(false);
  const [saved, setSaved] = createSignal<NoteDocument>();
  const [error, setError] = createSignal<string>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function run() {
    if (pending() || disposed) return;
    setPending(true);
    setError(undefined);
    const document = saved();
    const result = document
      ? (await options.source.link(document.documentId))
          .map(() => document)
          .mapErr(
            (failure): NoteCreateFailure => ({
              kind: 'created_unlinked',
              document,
              message: failure.message,
            })
          )
      : await options.source.create(`${options.title()} notes`);
    if (disposed) return;
    setPending(false);
    if (result.isErr()) {
      setError(result.error.message);
      if (result.error.kind === 'created_unlinked')
        setSaved(result.error.document);
      return;
    }
    setSaved(undefined);
    options.onOpen(result.value);
  }

  return {
    pending,
    saved,
    error,
    run,
    openSaved: () => {
      const document = saved();
      if (document && !pending() && !disposed) options.onOpen(document);
    },
  };
}
