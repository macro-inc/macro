/** @vitest-environment jsdom */
import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { channelKeys } from '../keys';

let client: QueryClient;
let dispose: () => void;
vi.mock('../../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@core/constant/servers', () => ({
  staticFileSizedEndpoint: (id: string) => `/file/${id}`,
}));
vi.mock('../../preview/dataloader', () => ({
  previewDataLoader: { load: vi.fn() },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { setChannelPicture: vi.fn() },
}));

import { useSetChannelPictureMutation } from '../picture';

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  dispose?.();
  client.clear();
});

function setup(upload: (file: File) => Promise<string>) {
  let mutation!: ReturnType<typeof useSetChannelPictureMutation>;
  function Fixture() {
    mutation = useSetChannelPictureMutation(upload);
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Fixture />
      </QueryClientProvider>
    ),
    document.body
  );
  return mutation;
}

it('publishes the picture only after both upload and channel save succeed', async () => {
  const upload = vi.fn().mockResolvedValue('new-picture');
  vi.mocked(storageServiceClient.setChannelPicture).mockResolvedValue(
    ok(undefined)
  );
  const mutation = setup(upload);
  const file = new File(['image'], 'picture.png', { type: 'image/png' });
  await mutation.mutateAsync({ channelId: 'channel', file });
  expect(upload).toHaveBeenCalledWith(file);
  expect(storageServiceClient.setChannelPicture).toHaveBeenCalledWith({
    channel_id: 'channel',
    profile_picture_id: 'new-picture',
  });
  expect(client.getQueryData(channelKeys.picture('channel').queryKey)).toBe(
    'new-picture'
  );
});

it('keeps the old picture when the channel save fails', async () => {
  client.setQueryData(channelKeys.picture('channel').queryKey, 'old-picture');
  vi.mocked(storageServiceClient.setChannelPicture).mockRejectedValue(
    new Error('Forbidden')
  );
  const mutation = setup(vi.fn().mockResolvedValue('new-picture'));
  await expect(
    mutation.mutateAsync({
      channelId: 'channel',
      file: new File(['image'], 'picture.png'),
    })
  ).rejects.toThrow();
  expect(client.getQueryData(channelKeys.picture('channel').queryKey)).toBe(
    'old-picture'
  );
});

it('does not change the channel when uploading fails', async () => {
  const mutation = setup(vi.fn().mockRejectedValue(new Error('Upload failed')));
  await expect(
    mutation.mutateAsync({
      channelId: 'channel',
      file: new File(['image'], 'picture.png'),
    })
  ).rejects.toThrow('Upload failed');
  expect(storageServiceClient.setChannelPicture).not.toHaveBeenCalled();
});

it('removes a picture without uploading a file or changing another channel', async () => {
  client.setQueryData(channelKeys.picture('channel').queryKey, 'old-picture');
  client.setQueryData(channelKeys.picture('other').queryKey, 'other-picture');
  vi.mocked(storageServiceClient.setChannelPicture).mockResolvedValue(
    ok(undefined)
  );
  const upload = vi.fn();
  const mutation = setup(upload);
  await mutation.mutateAsync({ channelId: 'channel', file: null });
  expect(upload).not.toHaveBeenCalled();
  expect(
    client.getQueryData(channelKeys.picture('channel').queryKey)
  ).toBeNull();
  expect(client.getQueryData(channelKeys.picture('other').queryKey)).toBe(
    'other-picture'
  );
});
