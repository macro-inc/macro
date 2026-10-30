import { createSignal, onCleanup } from 'solid-js';
import type { DocumentNotesSource } from '../context/notes-source';
import type { DocumentNoteLink } from '../core/types';

export function createDocumentNotesController(source: DocumentNotesSource) {
  const [selected, setSelected] = createSignal<DocumentNoteLink>();
  const [saving, setSaving] = createSignal(false);
  const [removing, setRemoving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  function select(link: DocumentNoteLink | undefined) {
    if (removing()) return;
    setSelected(link);
    setError(undefined);
  }
  async function remove() {
    const link = selected();
    if (!link || saving()) return;
    setSaving(true);
    setRemoving(true);
    const result = await source.unlink(link);
    if (disposed) return;
    setSaving(false);
    setRemoving(false);
    if (result.isErr()) setError(result.error.message);
    else select(undefined);
  }
  async function setTeam(link: DocumentNoteLink, teamId?: string) {
    if (saving()) return;
    setSaving(true);
    setError(undefined);
    const result = await source.setTeam(link, teamId);
    if (disposed) return;
    setSaving(false);
    if (result.isErr()) setError(result.error.message);
  }
  return { selected, saving, removing, error, select, remove, setTeam };
}
