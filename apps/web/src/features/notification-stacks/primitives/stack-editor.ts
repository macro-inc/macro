import { createSignal } from 'solid-js';
import {
  draftProblem,
  entityIds,
  type StackDraft,
  type StackEntityKind,
  type StackKind,
  type StackSource,
  sameSource,
  withEntityIds,
} from '../core/stack';

/** The draft a stack editor holds, and the edits a reader makes to it. */
export function createStackEditor(initial: StackDraft) {
  const [draft, setDraft] = createSignal(initial);

  return {
    draft,
    /** Why the draft cannot be saved yet, if anything. */
    problem: () => draftProblem(draft()),
    setName: (name: string) => setDraft({ ...draft(), name }),
    entityIds: (kind: StackEntityKind) => entityIds(draft(), kind),
    setEntityIds: (kind: StackEntityKind, ids: readonly string[]) =>
      setDraft(withEntityIds(draft(), kind, ids)),
    /**
     * Capture channels whose name contains `text`. Returns whether it was
     * added: empty text, and text already there, are not.
     */
    addNameText: (text: string): boolean => {
      const source: StackSource = {
        type: 'channelNameContains',
        text: text.trim(),
      };
      const taken = draft().sources.some((existing) =>
        sameSource(existing, source)
      );
      if (source.text === '' || taken) return false;
      setDraft({ ...draft(), sources: [...draft().sources, source] });
      return true;
    },
    removeSource: (source: StackSource) =>
      setDraft({
        ...draft(),
        sources: draft().sources.filter(
          (existing) => !sameSource(existing, source)
        ),
      }),
    removeSender: (id: string) =>
      setDraft({
        ...draft(),
        senders: draft().senders.filter((sender) => sender !== id),
      }),
    setKind: (kind: StackKind, captured: boolean) => {
      const others = draft().kinds.filter((existing) => existing !== kind);
      setDraft({ ...draft(), kinds: captured ? [...others, kind] : others });
    },
    setReleaseMentions: (releaseMentions: boolean) =>
      setDraft({ ...draft(), releaseMentions }),
    setReleaseReplies: (releaseReplies: boolean) =>
      setDraft({ ...draft(), releaseReplies }),
  };
}

export type StackEditor = ReturnType<typeof createStackEditor>;
