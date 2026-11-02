import { createMarkdownFile } from '@core/util/create';
import { catchToResult, throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { queryReadyGate } from '@queries/gate';
import { calendarNotesClient } from '@service-calendar/notes';
import { createDebouncedMemo } from '@solid-primitives/memo';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type { DocumentNotesSource, NotesSource } from '../context/notes-source';
import type {
  MeetingNote,
  NoteCreateFailure,
  NoteFailure,
  NoteTarget,
} from '../core/types';
import { notesKeys } from './keys';

function notesOptions(userId: string | undefined, target: NoteTarget) {
  return {
    queryKey: notesKeys.notes(userId, target).queryKey,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<MeetingNote[]> => {
      const notes = await throwOnErr(() =>
        calendarNotesClient.list(target.eventId, target.occurrenceKey, signal)
      );
      return notes.map((note) => ({ ...note, team: note.team ?? undefined }));
    },
    enabled: !!userId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  };
}

function pickerOptions(
  userId: string | undefined,
  query: string,
  enabled: boolean
) {
  return {
    queryKey: notesKeys.documents(userId, query).queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      throwOnErr(() => calendarNotesClient.documents(query, signal)),
    enabled: !!userId && enabled,
    staleTime: 0,
    gcTime: 0,
  };
}

type NoteWrite = NoteTarget & { documentId: string; teamId?: string };

function linkNote(input: NoteWrite) {
  return Telemetry.span('calendar.notes.link', async (span) => {
    span.setAttr('event.id', input.eventId);
    span.setAttr('document.id', input.documentId);
    await throwOnErr(() =>
      calendarNotesClient.link(
        input.eventId,
        input.occurrenceKey,
        input.documentId,
        { teamId: input.teamId ?? null }
      )
    );
  });
}

function unlinkNote(input: NoteWrite) {
  return Telemetry.span('calendar.notes.unlink', async (span) => {
    span.setAttr('event.id', input.eventId);
    span.setAttr('document.id', input.documentId);
    await throwOnErr(() =>
      calendarNotesClient.unlink(
        input.eventId,
        input.occurrenceKey,
        input.documentId
      )
    );
  });
}

function refreshNotes() {
  // The same meeting can be open through several inbox copies with distinct IDs.
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: notesKeys.notes._def }),
    queryClient.invalidateQueries({ queryKey: notesKeys.documentLinks._def }),
  ]);
}

export function createNotesSource(
  userId: Accessor<string | undefined>,
  target: Accessor<NoteTarget>
): NotesSource {
  const notes = useQuery(() => notesOptions(userId(), target()));
  const link = useMutation(() => ({
    mutationFn: linkNote,
    onSuccess: refreshNotes,
  }));
  const unlink = useMutation(() => ({
    mutationFn: unlinkNote,
    onSuccess: refreshNotes,
  }));
  return {
    notes: () => ({
      data: queryReadyGate(notes) ? notes.data : undefined,
      pending: notes.isPending,
      error: notes.isError ? 'Couldn’t load meeting notes.' : undefined,
    }),
    async create(name) {
      // Capture the occurrence and account before document creation yields.
      const destination = { ...target() };
      const owner = userId();
      return Telemetry.span('calendar.notes.create', async (span) => {
        span.setAttr('event.id', destination.eventId);
        const created = await catchToResult(() =>
          createMarkdownFile({
            title: name,
            source: 'calendar_notes',
          })
        );
        if (created.isErr() || !created.value) {
          span.setAttr('calendar.notes.outcome', 'create_failed');
          span.error('Meeting note creation failed');
          return err({
            kind: 'create_failed',
            message: 'Couldn’t create the note. Please try again.',
          } satisfies NoteCreateFailure);
        }
        const document = { documentId: created.value, name };
        span.setAttr('document.id', document.documentId);
        if (userId() !== owner) {
          span.setAttr('calendar.notes.outcome', 'account_changed');
          span.error('Account changed before meeting note linking');
          return err({
            kind: 'created_unlinked',
            document,
            message:
              'Your note was saved, but your account changed before it could be linked.',
          } satisfies NoteCreateFailure);
        }
        const linked = await catchToResult(() =>
          link.mutateAsync({ ...destination, documentId: document.documentId })
        );
        if (linked.isErr()) {
          span.setAttr('calendar.notes.outcome', 'created_unlinked');
          span.error('Created meeting note could not be linked');
          return err({
            kind: 'created_unlinked',
            document,
            message:
              'Your note was saved, but couldn’t be linked to this meeting. Retry linking or open the saved note.',
          } satisfies NoteCreateFailure);
        }
        span.setAttr('calendar.notes.outcome', 'linked');
        return ok(document);
      });
    },
    picker(query, enabled) {
      const debounced = createDebouncedMemo(query, 180);
      const picker = useQuery(() =>
        pickerOptions(userId(), debounced(), enabled())
      );
      return () => ({
        data: queryReadyGate(picker) ? picker.data : undefined,
        pending: picker.isPending,
        error: picker.isError
          ? 'Couldn’t load your notes. Try again.'
          : undefined,
      });
    },
    retry: () => notes.refetch(),
    async link(documentId, teamId) {
      const input = { ...target(), documentId, teamId };
      return (await catchToResult(() => link.mutateAsync(input))).mapErr(
        (): NoteFailure => ({
          kind: 'link_failed',
          message:
            'Couldn’t save this link. Check that you still own the note and can view the meeting, then try again.',
        })
      );
    },
    async unlink(documentId) {
      const input = { ...target(), documentId };
      return (await catchToResult(() => unlink.mutateAsync(input))).mapErr(
        (): NoteFailure => ({
          kind: 'unlink_failed',
          message:
            'Couldn’t unlink this note. Your document is safe. Please try again.',
        })
      );
    },
  };
}

function documentLinksOptions(userId: string | undefined, documentId: string) {
  return {
    queryKey: notesKeys.documentLinks(userId, documentId).queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const links = await throwOnErr(() =>
        calendarNotesClient.documentLinks(documentId, signal)
      );
      return links.map((link) => ({ ...link, team: link.team ?? undefined }));
    },
    enabled: !!userId,
    staleTime: 0,
    gcTime: 0,
  };
}

export function createDocumentNotesSource(
  userId: Accessor<string | undefined>,
  documentId: Accessor<string>
): DocumentNotesSource {
  const links = useQuery(() => documentLinksOptions(userId(), documentId()));
  const unlink = useMutation(() => ({
    mutationFn: unlinkNote,
    onSuccess: refreshNotes,
  }));
  return {
    links: () => ({
      data: queryReadyGate(links) ? links.data : undefined,
      pending: links.isPending,
      error: links.isError ? 'Couldn’t load meeting access.' : undefined,
    }),
    retry: () => links.refetch(),
    async unlink(target) {
      return (
        await catchToResult(() =>
          unlink.mutateAsync({ ...target, documentId: documentId() })
        )
      ).mapErr(
        (): NoteFailure => ({
          kind: 'unlink_failed',
          message: 'Couldn’t remove this meeting link. Please try again.',
        })
      );
    },
  };
}
