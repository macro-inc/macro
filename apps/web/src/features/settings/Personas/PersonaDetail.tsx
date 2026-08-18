import { BotAvatar } from '@channel/Bots/BotAvatar';
import { BotDeleteDialog } from '@channel/Bots/BotDeleteDialog';
import { BotFormSection } from '@channel/Bots/BotFormSection';
import { BotProfileFields } from '@channel/Bots/BotProfileFields';
import { slugBotHandle } from '@channel/Bots/botForm';
import { createBotAvatarUpload } from '@channel/Bots/createBotAvatarUpload';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import TrashIcon from '@phosphor/trash.svg';
import {
  useDeletePersonaMutation,
  usePersonaQuery,
  useUpdatePersonaMutation,
} from '@queries/bots/personas';
import { Button } from '@ui';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { PersonaAgentFields } from './PersonaAgentFields';
import {
  EMPTY_PERSONA_FORM,
  formValuesToAgentConfig,
  type PersonaFormErrors,
  personaToFormValues,
  validatePersonaForm,
} from './personaForm';

export function PersonaDetail(props: { botId: string; onBack: () => void }) {
  const personaQuery = usePersonaQuery(() => props.botId);
  const updatePersona = useUpdatePersonaMutation();
  const deletePersona = useDeletePersonaMutation();
  const [initialized, setInitialized] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [errors, setErrors] = createSignal<PersonaFormErrors>({});
  const [initialForm, setInitialForm] = createSignal({ ...EMPTY_PERSONA_FORM });
  const [form, setForm] = createStore({ ...EMPTY_PERSONA_FORM });
  const avatarUpload = createBotAvatarUpload((url) =>
    setForm('avatarUrl', url)
  );

  // Seeding a form store from a query is imperative by nature, and a later
  // refetch must never clobber unsaved edits - so this only ever runs once.
  createEffect(
    on(
      () => personaQuery.data,
      (persona) => {
        if (!persona || initialized()) return;
        const values = personaToFormValues(persona);
        setForm(values);
        setInitialForm(values);
        setInitialized(true);
      }
    )
  );

  const isDirty = createMemo(() => {
    const original = initialForm();
    return (
      form.name !== original.name ||
      form.handle !== original.handle ||
      form.description !== original.description ||
      form.avatarUrl !== original.avatarUrl ||
      form.systemPrompt !== original.systemPrompt ||
      form.harness !== original.harness ||
      form.model !== original.model ||
      form.repoUrl !== original.repoUrl
    );
  });

  const pending = () =>
    saving() || avatarUpload.uploading() || deletePersona.isPending;

  const leave = () => {
    if (pending()) return;
    props.onBack();
  };

  const save = async () => {
    const parsed = validatePersonaForm(form);
    if (!parsed.success) {
      setErrors(parsed.errors);
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      const persona = await updatePersona.mutateAsync({
        botId: props.botId,
        name: parsed.data.name,
        handle: parsed.data.handle,
        description: parsed.data.description,
        avatarUrl: parsed.data.avatarUrl,
        agent: formValuesToAgentConfig(parsed.data),
      });
      const nextForm = personaToFormValues(persona);
      setForm(nextForm);
      setInitialForm(nextForm);
      toast.success('Persona updated');
    } catch {
      toast.failure('Failed to update persona');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deletePersona.mutateAsync({ botId: props.botId });
      setDeleteOpen(false);
      toast.success('Persona deleted');
      props.onBack();
    } catch {
      toast.failure('Failed to delete persona');
    }
  };

  return (
    <>
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
          <Show
            when={initialized() && personaQuery.data}
            fallback={
              <div class="flex min-h-96 items-center justify-center">
                <LoadingSpinner class="size-16 p-4" />
              </div>
            }
          >
            {(persona) => (
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
                      name: form.name || persona().name,
                      avatar_url: form.avatarUrl || undefined,
                    }}
                    size="lg"
                  />
                  <div class="min-w-0">
                    <h1 class="truncate text-lg font-semibold tracking-[-0.01em]">
                      {form.name || persona().name}
                    </h1>
                    <p class="mt-0.5 truncate text-sm text-ink-muted">
                      @{form.handle || persona().handle}
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
                      setErrors((current) => ({
                        ...current,
                        handle: undefined,
                      }));
                    }}
                    onDescriptionChange={(value) =>
                      setForm('description', value)
                    }
                  />
                </BotFormSection>

                <BotFormSection
                  title="Agent"
                  description="What this persona runs when someone mentions it."
                >
                  <PersonaAgentFields
                    value={form}
                    errors={errors()}
                    initialSystemPrompt={initialForm().systemPrompt}
                    onSystemPromptChange={(value) =>
                      setForm('systemPrompt', value)
                    }
                    onHarnessChange={(value) =>
                      setForm('harness', value as typeof form.harness)
                    }
                    onModelChange={(value) =>
                      setForm('model', value as typeof form.model)
                    }
                    onRepoUrlChange={(value) => {
                      setForm('repoUrl', value);
                      setErrors((current) => ({
                        ...current,
                        repoUrl: undefined,
                      }));
                    }}
                  />
                </BotFormSection>

                <div class="flex items-center justify-between gap-3 pt-1">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={pending()}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <TrashIcon />
                    Delete persona
                  </Button>
                  <div class="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending()}
                      onClick={leave}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      variant="cta"
                      size="sm"
                      disabled={!isDirty() || pending()}
                    >
                      {saving() ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </Show>
        </main>
      </div>
      <BotDeleteDialog
        open={deleteOpen()}
        botName={personaQuery.data?.name}
        pending={deletePersona.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
