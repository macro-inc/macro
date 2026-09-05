import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailAttachment } from './core/email-message';
import { fetchImagesViaPlatform, resolveCidImages } from './image-adapter';

const { fetchImage } = vi.hoisted(() => ({ fetchImage: vi.fn() }));
vi.mock('@core/util/platform', () => ({ isTauri: () => true }));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: fetchImage }));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'static-file': 'https://files.example.com' },
}));

function imageRoot(src: string) {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const img = document.createElement('img');
  img.src = src;
  root.append(img);
  return { root, img };
}

describe('production image adaptation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchImage.mockReset();
  });
  it('resolves matching CID attachments and leaves unknown IDs unchanged', () => {
    const { root, img } = imageRoot('cid:part');
    const unknown = document.createElement('img');
    unknown.src = 'cid:unknown';
    root.append(unknown);
    resolveCidImages(root, [
      { content_id: '<part>', sfs_id: 'file-id' } as EmailAttachment,
    ]);
    expect(img.src).toBe('https://files.example.com/file/file-id');
    expect(unknown.getAttribute('src')).toBe('cid:unknown');
  });
  it('does not create a blob URL when disposed during the platform response body', async () => {
    const { root, img } = imageRoot('https://files.example.com/image');
    let finish!: (blob: Blob) => void;
    const blob = new Promise<Blob>((resolve) => {
      finish = resolve;
    });
    fetchImage.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      blob: () => blob,
    });
    const create = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create });
    let disposed = false;
    const pending = fetchImagesViaPlatform(root, [], () => disposed);
    await Promise.resolve();
    disposed = true;
    finish(new Blob());
    await pending;
    expect(create).not.toHaveBeenCalled();
    expect(img.getAttribute('src')).toBe('https://files.example.com/image');
  });
  it('retains successful native images for lifetime cleanup and rejects non-image responses', async () => {
    const { root, img } = imageRoot('https://files.example.com/image');
    fetchImage.mockResolvedValue(
      new Response('image', { headers: { 'content-type': 'image/png' } })
    );
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:resolved' });
    const urls: string[] = [];
    await fetchImagesViaPlatform(root, urls, () => false);
    expect(img.src).toBe('blob:resolved');
    expect(urls).toEqual(['blob:resolved']);
    const html = imageRoot('https://files.example.com/login');
    fetchImage.mockResolvedValue(
      new Response('login', { headers: { 'content-type': 'text/html' } })
    );
    await fetchImagesViaPlatform(html.root, urls, () => false);
    expect(html.img.getAttribute('src')).toBe(
      'https://files.example.com/login'
    );
    expect(urls).toEqual(['blob:resolved']);
  });
});
