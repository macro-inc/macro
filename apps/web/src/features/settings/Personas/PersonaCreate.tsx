import { BotAvatar } from '@channel/Bots/BotAvatar';
import { BotFormSection } from '@channel/Bots/BotFormSection';
import { BotProfileFields } from '@channel/Bots/BotProfileFields';
import { slugBotHandle } from '@channel/Bots/botForm';
import { createBotAvatarUpload } from '@channel/Bots/createBotAvatarUpload';
import { toast } from '@core/component/Toast/Toast';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import { useCreatePersonaMutation } from '@queries/bots/personas';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { PersonaInstructionsField } from './PersonaInstructionsField';
import {
  EMPTY_PERSONA_FORM,
  type PersonaFormErrors,
  validatePersonaForm,
} from './personaForm';

export function PersonaCreate(props: { onBack: () => void }) {
  const createPersona = useCreatePersonaMutation();
  const [saving, setSaving] = createSignal(false);
  const [errors, setErrors] = createSignal<PersonaFormErrors>({});
  // Once someone has typed a handle themselves it is theirs; until then it
  // follows the name as lower kebab-case.
  const [handleEdited, setHandleEdited] = createSignal(false);
  const [form, setForm] = createStore({ ...EMPTY_PERSONA_FORM });
  const avatarUpload = createBotAvatarUpload((url) =>
    setForm('avatarUrl', url)
  );

  const pending = () => saving() || avatarUpload.uploading();

  const leave = () => {
    if (pending()) return;
    props.onBack();
  };

  const save = async () => {
    const parsed = validatePersonaForm({
      ...form,
      handle: form.handle || slugBotHandle(form.name),
    });
    if (!parsed.success) {
      setErrors(parsed.errors);
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      await createPersona.mutateAsync({
        name: parsed.data.name,
        handle: parsed.data.handle,
        description: parsed.data.description || undefined,
        avatarUrl: parsed.data.avatarUrl || undefined,
        systemPrompt: parsed.data.systemPrompt.trim()
          ? parsed.data.systemPrompt
          : undefined,
      });
      toast.success('Agent created');
      props.onBack();
    } catch {
      toast.failure('Failed to create agent');
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
          Back to agents
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
                name: form.name || 'Agent',
                avatar_url: form.avatarUrl || undefined,
              }}
              size="lg"
            />
            <div class="min-w-0">
              <h1 class="truncate text-lg font-semibold tracking-[-0.01em]">
                {form.name || 'New agent'}
              </h1>
              <p class="mt-0.5 truncate text-sm text-ink-muted">
                @{form.handle || 'handle'}
              </p>
            </div>
          </header>

          <BotFormSection
            class="mt-3"
            title="Profile"
            description="How this agent appears in channels and mentions."
          >
            <BotProfileFields
              value={form}
              errors={errors()}
              uploadingAvatar={avatarUpload.uploading()}
              onUploadAvatar={avatarUpload.open}
              onNameChange={(value) => {
                setForm('name', value);
                if (!handleEdited()) setForm('handle', slugBotHandle(value));
                setErrors((current) => ({ ...current, name: undefined }));
              }}
              onHandleChange={(value) => {
                setHandleEdited(true);
                setForm('handle', slugBotHandle(value));
                setErrors((current) => ({ ...current, handle: undefined }));
              }}
              onDescriptionChange={(value) => setForm('description', value)}
            />
          </BotFormSection>

          <BotFormSection
            title="Instructions"
            description="What this agent is told at the start of every session."
          >
            <PersonaInstructionsField
              initialSystemPrompt=""
              onSystemPromptChange={(value) => setForm('systemPrompt', value)}
            />
          </BotFormSection>

          <Show when={errors().systemPrompt}>
            <p class="text-xs text-danger">{errors().systemPrompt}</p>
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
            <Button type="submit" variant="cta" size="sm" disabled={pending()}>
              {saving() ? 'Creating…' : 'Create agent'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
