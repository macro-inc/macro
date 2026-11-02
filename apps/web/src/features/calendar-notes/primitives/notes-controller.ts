import { createSignal, onCleanup } from 'solid-js';
import type { NotesSource } from '../context/notes-source';
import type { MeetingNote, NoteDocument } from '../core/types';

type NoteDialog =
  | { kind: 'link' }
  | { kind: 'sharing' | 'unlink'; note: MeetingNote };

export function createNotesController(
  source: NotesSource,
  onDialogChange: (open: boolean) => void
) {
  const [dialog, setDialog] = createSignal<NoteDialog>();
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal<NoteDocument>();
  const [teamId, setTeamId] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let menuDocumentId: string | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    onDialogChange(false);
  });
  const picker = source.picker(
    query,
    () => !!dialog() && dialog()?.kind !== 'unlink'
  );

  function reportOpen() {
    if (disposed) return;
    onDialogChange(!!menuDocumentId || !!dialog());
  }

  function open(next: NoteDialog) {
    if (saving()) return;
    setQuery('');
    setError(undefined);
    setSelected(next.kind === 'link' ? undefined : next.note);
    setTeamId(next.kind === 'link' ? undefined : next.note.team?.id);
    setDialog(next);
    reportOpen();
  }

  function close() {
    if (saving()) return;
    setDialog(undefined);
    reportOpen();
  }

  async function save() {
    const active = dialog();
    const document = selected();
    if (!active || !document || saving()) return;
    setSaving(true);
    setError(undefined);
    const result =
      active.kind === 'unlink'
        ? await source.unlink(document.documentId)
        : await source.link(document.documentId, teamId());
    if (disposed || dialog() !== active) return;
    setSaving(false);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    close();
  }

  return {
    dialog,
    query,
    setQuery,
    selected,
    setSelected,
    teamId,
    setTeamId,
    saving,
    error,
    picker,
    setMenuOpen: (documentId: string, open: boolean) => {
      if (open) menuDocumentId = documentId;
      else if (menuDocumentId === documentId) menuDocumentId = undefined;
      reportOpen();
    },
    close,
    save,
    openLink: () => open({ kind: 'link' }),
    openSharing: (note: MeetingNote) => open({ kind: 'sharing', note }),
    openUnlink: (note: MeetingNote) => open({ kind: 'unlink', note }),
  };
}

export type NotesController = ReturnType<typeof createNotesController>;
