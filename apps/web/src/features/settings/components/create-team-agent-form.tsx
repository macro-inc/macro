import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import { useUploadAgentAvatarMutation } from '@queries/agents/avatar';
import { useAgentModelsQuery } from '@queries/agents/models';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { useCreateTeamAgentMutation } from '@queries/team/agents';
import type { LoadAgentModelsResponse } from '@service-agent-harness/generated/schemas';
import type { Harness } from '@service-storage/client';
import { Avatar, Button } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { SettingsSelect } from './settings-select';

/** Runtimes that can host a team agent's brain: macrod, shared with the team. */
function teamRuntimes(harnesses: Harness[], teamId: string): Harness[] {
  return harnesses.filter(
    (harness) =>
      harness.kind === 'macrod' &&
      harness.owner.type === 'team' &&
      harness.owner.team_id === teamId
  );
}

/** The runtime's current model, else its first; `default` when it has no picker. */
function preferredModel(data: LoadAgentModelsResponse | undefined): string {
  if (!data) return '';
  if (data.status === 'unsupported') return 'default';

  const current = data.currentModel;
  if (current && data.models.some((model) => model.id === current)) {
    return current;
  }

  return data.models[0]?.id ?? '';
}

/**
 * Creates a team agent: an AI teammate with its own account and email, whose
 * brain runs on one of the team's macrod runtimes.
 */
export function CreateTeamAgentForm(props: {
  teamId: string;
  onDone: () => void;
}) {
  const harnessesQuery = useHarnessesQuery();
  const createAgent = useCreateTeamAgentMutation();
  const uploadAvatar = useUploadAgentAvatarMutation();

  const [name, setName] = createSignal('');
  const [jobDescription, setJobDescription] = createSignal('');
  const [personality, setPersonality] = createSignal('');
  const [avatarUrl, setAvatarUrl] = createSignal<string>();
  const [pickedRuntimeId, setPickedRuntimeId] = createSignal<string>();
  const [pickedModel, setPickedModel] = createSignal<string>();
  let avatarInputRef: HTMLInputElement | undefined;

  const runtimes = () =>
    harnessesQuery.isSuccess
      ? teamRuntimes(harnessesQuery.data, props.teamId)
      : [];
  const runtimeId = () =>
    pickedRuntimeId() ??
    runtimes().find((runtime) => runtime.connected)?.id ??
    runtimes()[0]?.id;
  const runtime = () => runtimes().find((r) => r.id === runtimeId());

  const modelsQuery = useAgentModelsQuery(
    () => ({ harness: 'macrod', harnessId: runtimeId() ?? '' }),
    () => runtime()?.connected === true
  );
  const models = () => (modelsQuery.isSuccess ? modelsQuery.data : undefined);
  const model = () => pickedModel() ?? preferredModel(models());

  const busy = () => createAgent.isPending || uploadAvatar.isPending;
  const canCreate = () =>
    !busy() &&
    name().trim().length > 0 &&
    jobDescription().trim().length > 0 &&
    personality().trim().length > 0 &&
    runtime()?.connected === true &&
    model().length > 0;

  const handleAvatarInput = async (file: File | undefined) => {
    if (!file) return;
    const result = await uploadAvatar.mutateAsync(file).catch(() => undefined);
    if (avatarInputRef) avatarInputRef.value = '';
    if (!result) {
      toast.failure('Failed to upload picture');
      return;
    }
    setAvatarUrl(result);
  };

  const pickRuntime = (id: string) => {
    setPickedRuntimeId(id);
    setPickedModel(undefined);
  };

  const submit = async () => {
    const harnessId = runtimeId();
    if (!canCreate() || !harnessId) return;

    const agentName = name().trim();
    const created = await createAgent
      .mutateAsync({
        teamId: props.teamId,
        request: {
          name: agentName,
          jobDescription: jobDescription().trim(),
          personality: personality().trim(),
          avatarUrl: avatarUrl() ?? null,
          harnessId,
          model: model(),
        },
      })
      .catch((error: unknown) => {
        toast.failure(
          error instanceof Error ? error.message : 'Failed to create agent'
        );
        return undefined;
      });
    if (!created) return;

    toast.success(
      `${agentName} joined the team. They're setting up and will message you when ready.`
    );
    props.onDone();
  };

  return (
    <form
      class="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        fireAndForget(submit(), 'team-agents');
      }}
    >
      <div class="text-xs text-ink-muted">
        An AI teammate with its own account, email address, and computer. It
        works with the team like a person would.
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          aria-label="Upload picture"
          disabled={busy()}
          class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => avatarInputRef?.click()}
        >
          <Avatar size="lg">
            <Show when={avatarUrl()}>
              {(url) => <Avatar.Image src={url()} alt="" />}
            </Show>
            <Avatar.Fallback>
              {(name().trim() || 'A').slice(0, 1).toUpperCase()}
            </Avatar.Fallback>
          </Avatar>
        </button>
        <div class="min-w-0 flex-1 text-xs text-ink-muted">
          Profile picture · optional
        </div>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          class="hidden"
          disabled={busy()}
          onChange={(event) =>
            fireAndForget(
              handleAvatarInput(event.currentTarget.files?.[0]),
              'team-agents'
            )
          }
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy()}
          onClick={() => avatarInputRef?.click()}
        >
          <UploadIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
          {uploadAvatar.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-ink">Name</span>
        <input
          class="settings-input w-full"
          placeholder="Sam"
          maxLength={80}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-ink">Job description</span>
        <textarea
          class="settings-input min-h-20 w-full resize-y py-2"
          placeholder="Runs our vendor relationships: finds venues, negotiates, books, and follows up."
          maxLength={4000}
          value={jobDescription()}
          onInput={(event) => setJobDescription(event.currentTarget.value)}
        />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-ink">Personality</span>
        <textarea
          class="settings-input min-h-20 w-full resize-y py-2"
          placeholder="Dry, direct, a little blunt. Warm with the team, tough with vendors."
          maxLength={4000}
          value={personality()}
          onInput={(event) => setPersonality(event.currentTarget.value)}
        />
      </label>

      <Switch>
        <Match when={harnessesQuery.isPending}>
          <div class="text-xs text-ink-muted">Loading runtimes…</div>
        </Match>
        <Match when={runtimes().length === 0}>
          <div class="text-xs text-ink-muted">
            Its brain runs on a computer shared with the team. Pair a macrod
            runtime in Settings → Agents → Runtimes and share it with the team
            first.
          </div>
        </Match>
        <Match when={runtimes().length > 0}>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-ink">Runs on</span>
              <SettingsSelect
                label="Runtime"
                options={runtimes().map((r) => ({
                  id: r.id,
                  name: r.connected ? r.name : `${r.name} · Offline`,
                }))}
                value={runtimeId()}
                onChange={pickRuntime}
                disabled={busy()}
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-ink">Model</span>
              <Show
                when={models()?.status === 'available'}
                fallback={
                  <p class="settings-input text-ink-muted">
                    {runtime()?.connected
                      ? modelsQuery.isError
                        ? 'Could not load models'
                        : models()
                          ? 'Runtime default'
                          : 'Loading models…'
                      : 'Runtime offline'}
                  </p>
                }
              >
                <SettingsSelect
                  label="Model"
                  options={(models()?.models ?? []).map((m) => ({
                    id: m.id,
                    name: m.name,
                  }))}
                  value={model()}
                  onChange={setPickedModel}
                  disabled={busy()}
                />
              </Show>
            </label>
          </div>
        </Match>
      </Switch>

      <div class="flex justify-end gap-1 pt-2">
        <Button
          type="button"
          variant="ghost"
          disabled={busy()}
          onClick={props.onDone}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canCreate()}>
          {createAgent.isPending ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
    </form>
  );
}
