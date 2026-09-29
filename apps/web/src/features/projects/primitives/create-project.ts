import type { Property, PropertyApiValues } from '@property/types';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  ProjectCreationResult,
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

const PROPERTIES_FAILED =
  'Your project was created, but some properties could not be saved. Retry to finish saving it.';

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
  // The composer may be closed by now; its signals still feed the failure draft.
  const settle = async (creation: Promise<ProjectCreationResult>) => {
    const result = await creation;
    setPending(false);
    match(result)
      .with({ status: 'created' }, ({ id }) => onCreated(id))
      .with({ status: 'propertiesFailed' }, ({ id }) => {
        setCreatedId(id);
        setError(PROPERTIES_FAILED);
      })
      .with({ status: 'failed' }, ({ error }) =>
        setError(
          createdId()
            ? PROPERTIES_FAILED
            : error.message || 'Could not create project.'
        )
      )
      .exhaustive();
    return result;
  };
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
    /**
     * Starts creation, or returns nothing when there is nothing to submit.
     * The project is listed as pending at once, so callers need not wait for
     * the returned outcome before closing the composer.
     */
    submit(): Promise<ProjectCreationResult> | undefined {
      if (pending() || !name().trim()) return;
      setPending(true);
      setError(undefined);
      return settle(
        commands.create({
          name: name().trim(),
          shareWithTeam: shareWithTeam(),
          properties: [...drafts().values()],
          createdId: createdId(),
        })
      );
    },
  };
}
