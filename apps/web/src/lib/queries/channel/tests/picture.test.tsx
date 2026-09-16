/** @vitest-environment jsdom */

import { ChannelAvatar } from '@channel/channel-avatar';
import { staticFileClient } from '@service-static-files/client';
import { storageServiceClient } from '@service-storage/client';
import { QueryObserver } from '@tanstack/query-core';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { previewDataLoader } from '../../preview/dataloader';
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
vi.mock('@service-static-files/client', () => ({
  staticFileClient: { getMetadata: vi.fn() },
}));
vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
}));

import {
  handleChannelPictureChanged,
  invalidateChannelPictures,
  useSetChannelPictureMutation,
} from '../picture';

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.mocked(staticFileClient.getMetadata).mockResolvedValue(
    ok({
      file_id: 'new-picture',
      owner_id: 'owner',
      content_type: 'image/png',
      is_uploaded: true,
      file_name: 'picture.png',
      s3_key: 'file/new-picture',
    })
  );
});
afterEach(() => {
  dispose?.();
  client.clear();
  vi.useRealTimers();
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
  expect(staticFileClient.getMetadata).not.toHaveBeenCalled();
  expect(
    client.getQueryData(channelKeys.picture('channel').queryKey)
  ).toBeNull();
  expect(client.getQueryData(channelKeys.picture('other').queryKey)).toBe(
    'other-picture'
  );
});

it('waits for asynchronous upload confirmation before assigning the picture', async () => {
  vi.useFakeTimers();
  vi.mocked(staticFileClient.getMetadata).mockResolvedValueOnce(
    ok({
      file_id: 'new-picture',
      owner_id: 'owner',
      content_type: 'image/png',
      is_uploaded: false,
      file_name: 'picture.png',
      s3_key: 'file/new-picture',
    })
  );
  vi.mocked(storageServiceClient.setChannelPicture).mockResolvedValue(
    ok(undefined)
  );
  const mutation = setup(vi.fn().mockResolvedValue('new-picture'));
  const pending = mutation.mutateAsync({
    channelId: 'channel',
    file: new File(['image'], 'picture.png'),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(storageServiceClient.setChannelPicture).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  await pending;
  expect(staticFileClient.getMetadata).toHaveBeenCalledTimes(2);
  expect(storageServiceClient.setChannelPicture).toHaveBeenCalledTimes(1);
});

it('preserves the existing picture if upload confirmation fails', async () => {
  client.setQueryData(channelKeys.picture('channel').queryKey, 'old-picture');
  vi.mocked(staticFileClient.getMetadata).mockRejectedValue(
    new Error('Unavailable')
  );
  const mutation = setup(vi.fn().mockResolvedValue('new-picture'));
  await expect(
    mutation.mutateAsync({
      channelId: 'channel',
      file: new File(['image'], 'picture.png'),
    })
  ).rejects.toThrow('Unavailable');
  expect(storageServiceClient.setChannelPicture).not.toHaveBeenCalled();
  expect(client.getQueryData(channelKeys.picture('channel').queryKey)).toBe(
    'old-picture'
  );
});

it('refreshes another session immediately on picture events and after reconnect', async () => {
  const queryKey = channelKeys.picture('channel').queryKey;
  client.setQueryData(queryKey, 'old-picture');
  client.setQueryData(
    channelKeys.picture('other').queryKey,
    'unrelated-picture'
  );
  const fetch = vi.fn().mockResolvedValue('new-picture');
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: fetch,
    staleTime: 60_000,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    handleChannelPictureChanged({ channel_id: 'channel' });
    await vi.waitFor(() =>
      expect(client.getQueryData(queryKey)).toBe('new-picture')
    );
    expect(client.getQueryData(channelKeys.picture('other').queryKey)).toBe(
      'unrelated-picture'
    );
    fetch.mockResolvedValue(null);
    handleChannelPictureChanged({ channel_id: 'channel' });
    await vi.waitFor(() => expect(client.getQueryData(queryKey)).toBeNull());
    fetch.mockResolvedValue('changed-while-offline');
    invalidateChannelPictures();
    await vi.waitFor(() =>
      expect(client.getQueryData(queryKey)).toBe('changed-while-offline')
    );
  } finally {
    unsubscribe();
  }
});

it.each(['picture event', 'reconnect'] as const)(
  'retries a failed image at the same URL after a %s',
  async (trigger) => {
    const queryKey = channelKeys.picture('channel').queryKey;
    client.setQueryData(queryKey, 'same-picture', {
      updatedAt: Date.now() - 1_000,
    });
    vi.mocked(previewDataLoader.load).mockResolvedValue({
      id: 'channel',
      type: 'channel',
      access: 'access',
      loading: false,
      name: 'Channel',
      rawName: 'Channel',
      profilePictureId: 'same-picture',
    });
    dispose = render(
      () => (
        <QueryClientProvider client={client}>
          <ChannelAvatar
            channelId="channel"
            fallback={<span data-testid="picture-fallback" />}
          />
        </QueryClientProvider>
      ),
      document.body
    );
    await vi.waitFor(() =>
      expect(document.querySelector('img')).not.toBeNull()
    );
    const failedImage = document.querySelector('img')!;
    failedImage.dispatchEvent(new Event('error'));
    expect(document.querySelector('img')).toBeNull();
    expect(
      document.querySelector('[data-testid="picture-fallback"]')
    ).not.toBeNull();
    expect(previewDataLoader.load).not.toHaveBeenCalled();

    if (trigger === 'reconnect') invalidateChannelPictures();
    else handleChannelPictureChanged({ channel_id: 'channel' });

    await vi.waitFor(() => {
      const retriedImage = document.querySelector('img');
      expect(retriedImage).not.toBeNull();
      expect(retriedImage).not.toBe(failedImage);
      expect(retriedImage?.getAttribute('src')).toBe('/file/same-picture');
    });
    expect(previewDataLoader.load).toHaveBeenCalledTimes(1);

    const recoveredImage = document.querySelector('img');
    await client.invalidateQueries({ queryKey });
    expect(previewDataLoader.load).toHaveBeenCalledTimes(2);
    expect(document.querySelector('img')).toBe(recoveredImage);
  }
);
