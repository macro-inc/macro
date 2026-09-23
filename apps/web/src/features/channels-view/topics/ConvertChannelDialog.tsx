import { toast } from '@core/component/Toast/Toast';
import { usePatchChannelMutation } from '@queries/channel/channels';
import { invalidateAllSoup } from '@queries/soup/cache';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { refreshChannelTopics, useChannelTopicsQuery } from './queries';

type Conversion = {
  id: string;
  name: string;
  type: 'private' | 'public';
  topicId?: string;
};

const [conversion, setConversion] = createSignal<Conversion>();

export function openConvertChannelDialog(value: Conversion) {
  setConversion(value);
}

export function ConvertChannelDialog() {
  const topicsQuery = useChannelTopicsQuery(() => !!conversion());
  const patch = usePatchChannelMutation();
  const [selectedTopicId, setSelectedTopicId] = createSignal<string>();
  const current = () => conversion();
  const chosen = () => selectedTopicId() ?? current()?.topicId;
  const close = () => {
    setConversion(undefined);
    setSelectedTopicId(undefined);
  };
  const confirm = async () => {
    const value = current();
    if (!value || patch.isPending) return;
    try {
      await patch.mutateAsync({
        channelId: value.id,
        convert_to_team_channel: true,
        topic_id: chosen(),
      });
      invalidateAllSoup();
      await refreshActiveGraphqlSoupQueries();
      await refreshChannelTopics();
      toast.success('#' + value.name + ' is now a team channel');
      close();
    } catch (error) {
      console.error('Failed to convert channel', error);
      toast.failure('Failed to make team channel');
    }
  };

  return (
    <Dialog open={!!current()} onOpenChange={(open) => !open && close()}>
      <Panel depth={2} class="w-[min(30rem,calc(100vw-2rem))] rounded-xl">
        <Panel.Body>
          <div class="flex flex-col gap-4 p-5">
            <Dialog.Title class="text-lg font-semibold text-ink">
              Make #{current()?.name} a team channel?
            </Dialog.Title>
            <p class="text-sm text-ink-muted">
              <Show
                when={current()?.type === 'public'}
                fallback="It's private today. Everyone on the team will be able to find it and join without an invite, and past messages come with it."
              >
                It includes people outside the company today, so converting it
                removes the guests. Everyone on the team will be able to find it
                and join without an invite, and past messages come with it.
              </Show>
            </p>
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium text-ink-muted">
                File it under:
              </span>
              <div class="flex flex-wrap gap-2">
                <For each={topicsQuery.isSuccess ? topicsQuery.data : []}>
                  {(topic) => (
                    <Button
                      size="sm"
                      variant={chosen() === topic.id ? 'accent' : 'outline'}
                      aria-pressed={chosen() === topic.id}
                      onClick={() => setSelectedTopicId(topic.id)}
                    >
                      {topic.name}
                    </Button>
                  )}
                </For>
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                {current()?.type === 'public'
                  ? 'Leave it as is'
                  : 'Keep it private'}
              </Button>
              <Button
                variant="cta"
                disabled={patch.isPending}
                onClick={() => void confirm()}
              >
                Make it a team channel
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
