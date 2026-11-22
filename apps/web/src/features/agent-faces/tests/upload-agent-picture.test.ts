import { uploadFile } from '@core/util/upload';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPictureUploads,
  uploadAgentPicture,
} from '../primitives/upload-agent-picture';

vi.mock('@core/util/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

const face = { v: 1, seed: 'example', pins: {} } as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('uploadAgentPicture', () => {
  it('keeps the face when PNG rendering fails', async () => {
    vi.stubGlobal(
      'Image',
      class {
        decode() {
          return Promise.reject(new Error('decode failed'));
        }
      }
    );
    const result = await uploadAgentPicture({
      face: () => face,
      photo: () => undefined,
    });
    expect(result.isOk() && result.value).toEqual({ face, url: null });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('reports a failed photo upload so the caller can keep its draft', async () => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('upload failed'));
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });
    const result = await uploadAgentPicture({
      face: () => face,
      photo: () => ({ kind: 'upload', file, url: 'blob:photo' }),
    });
    expect(result.isErr() && result.error).toEqual({
      kind: 'photo_upload_failed',
    });
  });

  it('keeps an existing photo without uploading it again', async () => {
    const result = await uploadAgentPicture({
      face: () => face,
      photo: () => ({ kind: 'saved', url: 'https://example.com/photo.png' }),
    });
    expect(result.isOk() && result.value).toEqual({
      face: null,
      url: 'https://example.com/photo.png',
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe('createPictureUploads', () => {
  it('uploads a picture once however often it is saved, and again once it changes', async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      failed: false,
      destination: 'static',
      id: '0192a8f0-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
    } as Awaited<ReturnType<typeof uploadFile>>);
    const upload = createPictureUploads();
    const first = new File(['one'], 'one.png', { type: 'image/png' });
    const photo = { kind: 'upload' as const, file: first, url: 'blob:one' };
    const draft = { face: () => face, photo: () => photo };

    const saved = await upload(draft);
    // Try again after a declined card: the same photo.
    const again = await upload(draft);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(again.isOk() && again.value).toEqual(saved.isOk() && saved.value);

    const second = new File(['two'], 'two.png', { type: 'image/png' });
    await upload({
      face: () => face,
      photo: () => ({ kind: 'upload', file: second, url: 'blob:two' }),
    });
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });
});
