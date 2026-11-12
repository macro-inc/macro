import type { SavedViewFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';
import type {
  CreateSavedView,
  UpdateSavedView,
} from '../../saved-views/core/saved-view';

const [records, setRecords] = createSignal<SavedViewFieldsFragment[]>([]);
export const savedRecords = records;
export function seedUnsupported() {
  setRecords((items) => [
    ...items,
    {
      id: 'unsupported',
      ownerId: 'viewer',
      name: 'Future definition',
      config: { kind: 'projects', version: 999 },
      sharedTeamId: null,
      revision: 1,
      createdAt: '',
      updatedAt: '',
    },
  ]);
}

export const savedViewErrorMessage = (error: { message: string } | null) =>
  error?.message;
export function useCreateSavedView() {
  const [isPending, setPending] = createSignal(false);
  return {
    get isPending() {
      return isPending();
    },
    error: null,
    mutateAsync: async (input: CreateSavedView) => {
      setPending(true);
      const record: SavedViewFieldsFragment = {
        ...input,
        ownerId: 'viewer',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      };
      setRecords((items) => [...items, record]);
      setPending(false);
      return { error: null, data: { createSavedView: record } };
    },
  };
}
export function useUpdateSavedView() {
  const [isPending, setPending] = createSignal(false);
  return {
    get isPending() {
      return isPending();
    },
    error: null,
    mutateAsync: async (input: UpdateSavedView) => {
      setPending(true);
      const current = records().find((item) => item.id === input.id);
      if (!current || current.revision !== input.expectedRevision) {
        setPending(false);
        return { error: { message: 'Revision conflict' }, data: undefined };
      }
      const record: SavedViewFieldsFragment = {
        ...current,
        name: input.name,
        config: input.config,
        sharedTeamId:
          input.sharedTeamId === undefined
            ? current.sharedTeamId
            : input.sharedTeamId,
        revision: current.revision + 1,
      };
      setRecords((items) =>
        items.map((item) => (item.id === input.id ? record : item))
      );
      setPending(false);
      return { error: null, data: { updateSavedView: record } };
    },
  };
}
export function useDeleteSavedView() {
  const [isPending, setPending] = createSignal(false);
  return {
    get isPending() {
      return isPending();
    },
    error: null,
    mutateAsync: async (input: { id: string; expectedRevision: number }) => {
      setPending(true);
      setRecords((items) =>
        items.filter(
          (item) =>
            item.id !== input.id || item.revision !== input.expectedRevision
        )
      );
      setPending(false);
      return { error: null, data: { deleteSavedView: true } };
    },
  };
}
