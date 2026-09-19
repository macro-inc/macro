import { createSignal } from 'solid-js';
import type { AgentEditorSource } from '../context/editor-source';
import {
  type AgentApps,
  type AgentDraft,
  agentHandle,
  preferredModel,
  runtimeSupportsTeam,
} from '../core/types';

export function createAgentDraft(
  initial: AgentDraft,
  source: AgentEditorSource,
  editing: boolean
) {
  const [draft, setDraft] = createSignal<AgentDraft>(initial);
  const [handleEdited, setHandleEdited] = createSignal(editing);
  const [error, setError] = createSignal('');
  const [discarding, setDiscarding] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  let rememberedApps =
    initial.apps.scope === 'selected' ? initial.apps.servers : [];
  const update = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
    setDiscarding(false);
  };
  const runtime = () =>
    source.runtimes().find((runtime) => runtime.id === draft().runtimeId);
  const catalog = () => source.catalog(draft().runtimeId);
  const modelId = () => draft().modelId || preferredModel(catalog());
  const busy = () => submitting() || source.pending();
  const dirty = () => JSON.stringify(draft()) !== JSON.stringify(initial);
  const teamRuntimeMismatch = () => {
    const selected = runtime();
    return (
      draft().share === 'Team' &&
      selected !== undefined &&
      !runtimeSupportsTeam(selected, source.teamId())
    );
  };
  const validation = () => {
    if (!draft().name.trim()) return 'Give your agent a name to continue.';
    if (!agentHandle(draft().handle))
      return 'Add a handle using letters, numbers, hyphens, or underscores.';
    if (!runtime()) return 'Choose an available runtime to continue.';
    if (teamRuntimeMismatch())
      return 'Choose a team runtime, or keep this agent private.';
    if (!modelId()) return 'Choose a model once this runtime finishes loading.';
    if (draft().channelScope === 'selected' && draft().channelIds.length === 0)
      return 'Choose at least one channel, or select All channels.';
    if (draft().share === 'Team' && !source.canShareWithTeam())
      return 'Join a team before sharing this agent.';
    if (draft().share === 'Private' && !source.canMakePrivate())
      return 'Only the agent creator can make it private.';
    return '';
  };
  const modelOptions = () => {
    const current = catalog();
    if (current.state !== 'available') return [];
    const selected = modelId();
    if (!selected || current.models.some((model) => model.id === selected))
      return current.models;
    const saved =
      editing &&
      initial.runtimeId === draft().runtimeId &&
      initial.modelId === selected;
    return [
      ...current.models,
      {
        id: selected,
        name: `${selected} (${saved ? 'saved, ' : ''}unavailable)`,
      },
    ];
  };
  const setName = (value: string) => {
    update('name', value);
    if (!handleEdited()) update('handle', agentHandle(value));
  };
  const setHandle = (value: string) => {
    setHandleEdited(true);
    update('handle', agentHandle(value));
  };
  const setRuntime = (id: string) => {
    update('runtimeId', id);
    update('modelId', preferredModel(source.catalog(id)));
  };
  const setApps = (apps: AgentApps) => {
    if (apps.scope === 'selected') rememberedApps = apps.servers;
    update('apps', apps);
  };
  const setAppScope = (scope: AgentApps['scope']) =>
    setApps(
      scope === 'selected' ? { scope, servers: rememberedApps } : { scope }
    );
  const save = async () => {
    if (busy()) return false;
    const invalid = validation();
    if (invalid) {
      setError(invalid);
      return false;
    }
    setSubmitting(true);
    setError('');
    try {
      const saved = await source.save({
        ...draft(),
        name: draft().name.trim(),
        handle: agentHandle(draft().handle),
        instructions: draft().instructions.trim(),
        modelId: modelId(),
      });
      if (!saved)
        setError(
          'Could not save your agent. Your changes are still here. Please try again.'
        );
      return saved;
    } catch {
      setError(
        'Could not save your agent. Your changes are still here. Please try again.'
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };
  return {
    draft,
    update,
    setName,
    setHandle,
    setRuntime,
    setApps,
    setAppScope,
    runtime,
    catalog,
    modelId,
    modelOptions,
    busy,
    dirty,
    validation,
    teamRuntimeMismatch,
    save,
    error,
    discarding,
    setDiscarding,
  };
}
