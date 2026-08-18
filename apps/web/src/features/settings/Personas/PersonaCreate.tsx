import { BotAvatar } from '@channel/Bots/BotAvatar';
import { BotFormSection } from '@channel/Bots/BotFormSection';
import { BotProfileFields } from '@channel/Bots/BotProfileFields';
import { slugBotHandle } from '@channel/Bots/botForm';
import { createBotAvatarUpload } from '@channel/Bots/createBotAvatarUpload';
import { toast } from '@core/component/Toast/Toast';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import { useCreatePersonaMutation } from '@queries/bots/personas';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { PersonaAgentFields } from './PersonaAgentFields';
import {
  EMPTY_PERSONA_FORM,
  formValuesToAgentConfig,
  type PersonaFormErrors,
  validatePersonaForm,
} from './personaForm';

export function PersonaCreate(props: { onBack: () => void }) {
  const createPersona = useCreatePersonaMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const isTeamAdmin = useIsTeamAdmin();
  const [saving, setSaving] = createSignal(false);
  const [errors, setErrors] = createSignal<PersonaFormErrors>({});
  const [form, setForm] = createStore({ ...EMPTY_PERSONA_FORM });
  const avatarUpload = createBotAvatarUpload((url) =>
    setForm('avatarUrl', url)
  );

  const currentTeam = createMemo(() => currentTeamQuery.data?.team);
  // We host a persona's sandbox on the team's behalf, so there is no personal
  // variant: without a team there is nothing to create it under.
  const canCreate = createMemo(() => !!currentTeam() && isTeamAdmin());
  const pending = () => saving() || avatarUpload.uploading();

  const leave = () => {
    if (pending()) return;
    props.onBack();
  };

  const save = async () => {
    const teamId = currentTeam()?.id;
    if (!teamId || !isTeamAdmin()) {
      toast.failure('Only team admins and owners can create personas');
      return;
    }

    const parsed = validatePersonaForm(form);
    if (!parsed.success) {
      setErrors(parsed.errors);
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      await createPersona.mutateAsync({
        teamId,
        name: parsed.data.name,
        handle: parsed.data.handle,
        description: parsed.data.description,
        avatarUrl: parsed.data.avatarUrl,
        agent: formValuesToAgentConfig(parsed.data),
      });
      toast.success('Persona created');
      props.onBack();
    } catch {
      toast.failure('Failed to create persona');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="size-full overflow-y-auto bg-surface text-ink">
      <main class="mx-auto w-full max-w-[560px] px-8 pt-14 pb-24 mobile:px-5 mobile:pt-8 mobile:pb-12">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="-ml-2 mb-7"
          disabled={pending()}
          onClick={leave}
        >
          <CaretLeftIcon />
          Back to personas
        </Button>

        <form
          class="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <header class="flex items-center gap-3">
            <BotAvatar
              bot={{
                name: form.name || 'Persona',
                avatar_url: form.avatarUrl || undefined,
              }}
              size="lg"
            />
            <div class="min-w-0">
              <h1 class="truncate text-lg font-semibold tracking-[-0.01em]">
                {form.name || 'New persona'}
              </h1>
              <p class="mt-0.5 truncate text-sm text-ink-muted">
                @{form.handle || 'handle'}
              </p>
            </div>
          </header>

          <BotFormSection
            class="mt-3"
            title="Profile"
            description="How this persona appears in channels and mentions."
          >
            <BotProfileFields
              value={form}
              errors={errors()}
              uploadingAvatar={avatarUpload.uploading()}
              onUploadAvatar={avatarUpload.open}
              onNameChange={(value) => {
                setForm('name', value);
                setErrors((current) => ({ ...current, name: undefined }));
              }}
              onHandleChange={(value) => {
                setForm('handle', slugBotHandle(value));
                setErrors((current) => ({ ...current, handle: undefined }));
              }}
              onDescriptionChange={(value) => setForm('description', value)}
            />
          </BotFormSection>

          <BotFormSection
            title="Agent"
            description="What this persona runs when someone mentions it."
          >
            <PersonaAgentFields
              value={form}
              errors={errors()}
              initialSystemPrompt=""
              onSystemPromptChange={(value) => setForm('systemPrompt', value)}
              onHarnessChange={(value) =>
                setForm('harness', value as typeof form.harness)
              }
              onModelChange={(value) =>
                setForm('model', value as typeof form.model)
              }
              onRepoUrlChange={(value) => {
                setForm('repoUrl', value);
                setErrors((current) => ({ ...current, repoUrl: undefined }));
              }}
            />
          </BotFormSection>

          <Show when={!canCreate()}>
            <p class="text-xs text-ink-muted">
              {currentTeam()
                ? 'Only team admins and owners can create personas.'
                : 'Join or create a team to create a persona.'}
            </p>
          </Show>

          <div class="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending()}
              onClick={leave}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="cta"
              size="sm"
              disabled={pending() || !canCreate()}
            >
              {saving() ? 'Creating…' : 'Create persona'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
