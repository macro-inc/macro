import type { Property, PropertyApiValues } from '@property/types';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  ProjectCreationInput,
  ProjectCreationResult,
  ProjectPropertyDraft,
  ProjectsContext,
} from '../context/projects-context';

export type ProjectComposerDraft = ProjectCreationInput & { error?: string };

/** What the composer hands its host: it closes, and the host owns the outcome. */
export type ProjectComposerSubmission = {
  draft: ProjectComposerDraft;
  result: Promise<ProjectCreationResult>;
};

const PROPERTIES_FAILED =
  'Your project was created, but some properties could not be saved. Retry to finish saving it.';

/** Reopens a failed submission, keeping a created id so retry cannot duplicate it. */
export function failedProjectDraft(
  draft: ProjectComposerDraft,
  result: Exclude<ProjectCreationResult, { status: 'created' }>
): ProjectComposerDraft {
  return match(result)
    .with({ status: 'propertiesFailed' }, ({ id }) => ({
      ...draft,
      createdId: id,
      error: PROPERTIES_FAILED,
    }))
    .with({ status: 'failed' }, ({ error }) => ({
      ...draft,
      error: error.message || 'Could not create project.',
    }))
    .exhaustive();
}

export function createProjectComposer(
  commands: ReturnType<ProjectsContext['createCommands']>,
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
  const createdId = initial?.createdId;
  // A submitted composer is finished; its host closes it.
  const [submitted, setSubmitted] = createSignal(false);
  const [error, setError] = createSignal(initial?.error);
  const snapshot = (): ProjectComposerDraft => ({
    name: name(),
    shareWithTeam: shareWithTeam(),
    properties: [...drafts().values()],
    createdId,
    error: error(),
  });
  return {
    name,
    setName,
    shareWithTeam,
    setShareWithTeam,
    drafts,
    submitted,
    error,
    createdId,
    snapshot,
    clear() {
      if (submitted() || createdId) return;
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
    /** Starts creation once, or returns nothing when there is nothing to submit. */
    submit(): ProjectComposerSubmission | undefined {
      if (submitted() || !name().trim()) return;
      setSubmitted(true);
      const { error: _stale, ...draft } = snapshot();
      return {
        draft,
        result: commands.create({ ...draft, name: draft.name.trim() }),
      };
    },
  };
}
