import { isChannelPreviewItem, useItemPreview } from '@queries/preview';
import { type Accessor, mapArray } from 'solid-js';

/** Reuse shared cache/batching, retaining DM identity for the shared Share UI. */
export function createProjectChannelPreviewsSource(
  ids: Accessor<readonly string[]>
): Accessor<ReadonlyMap<string, { name: string; type?: string }>> {
  const previews = mapArray(ids, (id) => {
    const [preview] = useItemPreview(() => ({ id, type: 'channel' }));
    return preview;
  });
  return () =>
    new Map(
      previews().map((preview) => {
        const channel = preview();
        return [
          channel.id,
          isChannelPreviewItem(channel)
            ? { name: channel.name, type: channel.channelType }
            : {
                name: channel.loading
                  ? 'Loading channel…'
                  : 'Unavailable channel',
              },
        ];
      })
    );
}

export function createProjectChannelNamesSource(
  ids: Accessor<readonly string[]>
): Accessor<ReadonlyMap<string, string>> {
  const previews = createProjectChannelPreviewsSource(ids);
  return () =>
    new Map([...previews()].map(([id, preview]) => [id, preview.name]));
}
