import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import { useChannelsContext } from '@core/context/channels';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import RobotIcon from '@phosphor/robot.svg';
import {
  useCreateBotMutation,
  useCreateBotTokenMutation,
} from '@queries/bots/bots';
import {
  useAddBotToChannelsMutation,
  useCreateChannelScopedBotMutation,
} from '@queries/channel/channel-bots';
import { ChannelTypeEnum } from '@service-storage/client';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { BotCreationResult } from './BotCreationResult';
import { BotFormSection } from './BotFormSection';
import { BotProfileFields } from './BotProfileFields';
import {
  type BotFormErrors,
  EMPTY_BOT_FORM,
  slugBotHandle,
  validateBotForm,
} from './botForm';
import { ChannelMultiSelect } from './ChannelMultiSelect';
import { createBotAvatarUpload } from './createBotAvatarUpload';

type Stage = 'form' | 'creating' | 'ready';

export function BotCreate(props: { channelId?: string; onBack: () => void }) {
  const channelsContext = useChannelsContext();
  const createBotMutation = useCreateBotMutation();
  const createTokenMutation = useCreateBotTokenMutation();
  const createScopedBotMutation = useCreateChannelScopedBotMutation();
  const addBotToChannelsMutation = useAddBotToChannelsMutation();
  const [stage, setStage] = createSignal<Stage>('form');
  const [handleEdited, setHandleEdited] = createSignal(false);
  const [errors, setErrors] = createSignal<BotFormErrors>({});
  const [createdBot, setCreatedBot] = createSignal<Bot>();
  const [createdChannelIds, setCreatedChannelIds] = createSignal<string[]>([]);
  const [rawToken, setRawToken] = createSignal<string>();
  const [tokenFailed, setTokenFailed] = createSignal(false);
  const [selectedChannelIds, setSelectedChannelIds] = createSignal<string[]>(
    props.channelId ? [props.channelId] : []
  );
  const [form, setForm] = createStore({ ...EMPTY_BOT_FORM });
  const avatarUpload = createBotAvatarUpload((url) =>
    setForm('avatarUrl', url)
  );

  const channelOptions = createMemo(() =>
    channelsContext
      .channels()
      .filter((channel) => channel.channel_type === ChannelTypeEnum.Private)
      .map((channel) => ({
        id: channel.id,
        name: channel.name?.trim() || 'Unnamed channel',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  const resultChannels = createMemo(() => {
    const selected = new Set(createdChannelIds());
    return channelOptions().filter((channel) => selected.has(channel.id));
  });
  const pending = () => stage() === 'creating' || avatarUpload.uploading();

  const leave = () => {
    if (pending()) return;
    props.onBack();
  };

  const finish = (bot: Bot, token?: string) => {
    setCreatedBot(bot);
    setRawToken(token);
    setStage('ready');
  };

  const submit = () => {
    const parsed = validateBotForm({
      ...form,
      handle: form.handle || slugBotHandle(form.name),
    });
    if (!parsed.success) {
      setErrors(parsed.errors);
      return;
    }

    const values = parsed.data;
    const channelIds = selectedChannelIds();
    const [firstChannelId, ...remainingChannelIds] = channelIds;
    setErrors({});
    setCreatedChannelIds(channelIds);
    setStage('creating');

    if (firstChannelId) {
      createScopedBotMutation.mutate(
        {
          channelId: firstChannelId,
          name: values.name,
          handle: values.handle,
          description: values.description || undefined,
          avatar_url: values.avatarUrl || undefined,
          token_label: 'webhook',
        },
        {
          onSuccess: async ({ bot, bot_token }) => {
            if (remainingChannelIds.length > 0) {
              const result = await addBotToChannelsMutation.mutateAsync({
                botId: bot.id,
                channelIds: remainingChannelIds,
              });
              setCreatedChannelIds([firstChannelId, ...result.addedChannelIds]);
              if (result.failedCount > 0) {
                toast.failure(
                  `${result.failedCount} channel assignment${result.failedCount === 1 ? '' : 's'} could not be completed`
                );
              }
            }
            finish(bot, bot_token);
          },
          onError: () => {
            setStage('form');
            toast.failure('Failed to create bot');
          },
        }
      );
      return;
    }

    createBotMutation.mutate(
      {
        name: values.name,
        handle: values.handle,
        description: values.description || undefined,
        avatarUrl: values.avatarUrl || undefined,
      },
      {
        onSuccess: (bot) => {
          setCreatedBot(bot);
          createTokenMutation.mutate(
            { botId: bot.id, label: 'webhook' },
            {
              onSuccess: ({ bearer_token }) => finish(bot, bearer_token),
              onError: () => {
                setTokenFailed(true);
                finish(bot);
              },
            }
          );
        },
        onError: () => {
          setStage('form');
          toast.failure('Failed to create bot');
        },
      }
    );
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
          Back to bots
        </Button>
        <Show when={stage() !== 'ready'}>
          <header class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-edge-muted bg-ink/[0.025] text-ink-muted">
              <RobotIcon class="size-5" />
            </div>
            <div class="min-w-0">
              <h1 class="text-lg font-semibold tracking-[-0.01em]">
                Create a bot
              </h1>
              <p class="mt-0.5 text-sm text-ink-muted">
                Give an integration a profile and a secure channel webhook.
              </p>
            </div>
          </header>
        </Show>

        <Show when={stage() === 'form'}>
          <form
            class="mt-8 flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <BotFormSection
              title="Profile"
              description="This is how the bot appears in channels and mentions."
            >
              <BotProfileFields
                value={form}
                errors={errors()}
                uploadingAvatar={avatarUpload.uploading()}
                onUploadAvatar={avatarUpload.open}
                onNameChange={(value) => {
                  setForm('name', value);
                  setErrors((current) => ({
                    ...current,
                    name: undefined,
                  }));
                  if (!handleEdited()) {
                    setForm('handle', slugBotHandle(value));
                  }
                }}
                onHandleChange={(value) => {
                  setHandleEdited(true);
                  setForm('handle', slugBotHandle(value));
                  setErrors((current) => ({
                    ...current,
                    handle: undefined,
                  }));
                }}
                onDescriptionChange={(value) => setForm('description', value)}
              />
            </BotFormSection>

            <BotFormSection
              title="Channels"
              description="Add the bot now to get ready-to-use webhook URLs."
            >
              <label class="mb-1.5 block text-xs font-medium">
                Add to channels <span class="text-ink-muted">· optional</span>
              </label>
              <ChannelMultiSelect
                channelIds={selectedChannelIds()}
                onChange={setSelectedChannelIds}
              />
              <p class="mt-2 text-xs text-ink-muted">
                Each selected channel gets its own webhook URL. You can change
                these assignments later.
              </p>
            </BotFormSection>

            <div class="flex items-center justify-between gap-4 pt-1">
              <p class="text-xs text-ink-muted">
                A webhook token is generated automatically.
              </p>
              <div class="flex shrink-0 gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={leave}>
                  Cancel
                </Button>
                <Button type="submit" variant="cta" size="sm">
                  Create bot
                </Button>
              </div>
            </div>
          </form>
        </Show>

        <Show when={stage() === 'creating'}>
          <div class="flex min-h-96 flex-col items-center justify-center gap-4 text-center">
            <LoadingSpinner class="size-16 p-4" />
            <div>
              <div class="text-sm font-medium">Creating your bot…</div>
              <div class="mt-1 text-xs text-ink-muted">
                Setting up its profile, channels, and webhook token.
              </div>
            </div>
          </div>
        </Show>

        <Show when={stage() === 'ready' && createdBot()}>
          {(bot) => (
            <BotCreationResult
              bot={bot()}
              channels={resultChannels()}
              token={rawToken()}
              tokenFailed={tokenFailed()}
              onDone={leave}
            />
          )}
        </Show>
      </main>
    </div>
  );
}
