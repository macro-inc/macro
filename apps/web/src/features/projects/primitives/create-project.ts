import type { Property, PropertyApiValues } from '@property/types';
import { createSignal } from 'solid-js';
import type {
  ProjectCreationInput,
  ProjectPropertyDraft,
  ProjectsContext,
} from '../context/projects-context';
import type { ProjectDetail } from '../core/project';

export type ProjectComposerDraft = ProjectCreationInput & { error?: string };

/** What the composer hands its host: it closes, and the host owns the outcome. */
export type ProjectComposerSubmission = {
  draft: ProjectComposerDraft;
  result: Promise<ProjectDetail>;
};

/** Reopens a failed submission with its draft and the server's reason. */
export function failedProjectDraft(
  draft: ProjectComposerDraft,
  error: unknown
): ProjectComposerDraft {
  return {
    ...draft,
    error:
      error instanceof Error && error.message
        ? error.message
        : 'Could not create project.',
  };
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
  // A submitted composer is finished; its host closes it.
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(initial?.error);
  const snapshot = (): ProjectComposerDraft => ({
    name: name(),
    shareWithTeam: shareWithTeam(),
    properties: [...drafts().values()],
    error: error(),
  });
  return {
    name,
    setName,
    shareWithTeam,
    setShareWithTeam,
    drafts,
    pending,
    error,
    snapshot,
    clear() {
      if (pending()) return;
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
      if (pending() || !name().trim()) return;
      setPending(true);
      const { error: _stale, ...draft } = snapshot();
      return {
        draft,
        result: commands.create({ ...draft, name: draft.name.trim() }),
      };
    },
  };
}
