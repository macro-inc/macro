import { uploadFile } from '@core/util/upload';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadAgentPicture } from '../primitives/upload-agent-picture';

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
