import type { Property, PropertyApiValues } from '@property/types';
import { createSignal } from 'solid-js';
import type {
  ProjectPropertyDraft,
  ProjectsContext,
} from '../context/projects-context';

export type ProjectComposerDraft = {
  name: string;
  shareWithTeam: boolean;
  properties: ProjectPropertyDraft[];
  createdId?: string;
  error?: string;
};

/** Retain the created identity if a property save fails so retry cannot duplicate it. */
export function createProjectComposer(
  commands: ReturnType<ProjectsContext['createCommands']>,
  onCreated: (id: string) => void,
  initial?: ProjectComposerDraft
) {
  const [name, setName] = createSignal(initial?.name ?? '');
  const [shareWithTeam, setShareWithTeam] = createSignal(
    initial?.shareWithTeam ?? true
  );
  const [drafts, setDrafts] = createSignal(
    new Map<string, ProjectPropertyDraft>(
      initial?.properties.map((draft) => [
        draft.property.propertyDefinitionId,
        draft,
      ])
    )
  );
  const [createdId, setCreatedId] = createSignal(initial?.createdId);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(initial?.error);
  return {
    name,
    setName,
    shareWithTeam,
    setShareWithTeam,
    drafts,
    pending,
    error,
    createdId,
    snapshot: (): ProjectComposerDraft => ({
      name: name(),
      shareWithTeam: shareWithTeam(),
      properties: [...drafts().values()],
      createdId: createdId(),
      error: error(),
    }),
    clear() {
      if (pending() || createdId()) return;
      setName('');
      setShareWithTeam(true);
      setDrafts(new Map());
      setError(undefined);
    },
    saveDraft: (property: Property, value: PropertyApiValues) =>
      setDrafts((previous) =>
        new Map(previous).set(property.propertyDefinitionId, {
          property,
          value,
        })
      ),
    async submit(): Promise<'created' | 'failed' | undefined> {
      if (pending() || !name().trim()) return;
      setPending(true);
      setError(undefined);
      try {
        const id =
          createdId() ??
          (
            await commands.create({
              name: name().trim(),
              shareWithTeam: shareWithTeam(),
            })
          ).id;
        setCreatedId(id);
        for (const { property, value } of drafts().values())
          await commands.saveProperty(id, property, value);
        onCreated(id);
        return 'created';
      } catch (error) {
        setError(
          createdId()
            ? 'Your project was created, but some properties could not be saved. Retry to finish saving it.'
            : error instanceof Error
              ? error.message
              : 'Could not create project.'
        );
        return 'failed';
      } finally {
        setPending(false);
      }
    },
  };
}
