import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import app from '../index';

const image = {
  staticFileId: '00112233-4455-4677-8899-aabbccddeeff',
  url: 'https://static.example/file/image',
  width: 1536,
  height: 1024,
};
const request = (body: unknown, authenticated = true) =>
  app.request(
    '/image-markdown',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { 'x-internal-auth-key': 'test-key' } : {}),
      },
      body: JSON.stringify(body),
    },
    { INTERNAL_AUTH_KEY: 'test-key' }
  );

describe('image markdown endpoint', () => {
  it('serializes a real image node with dimensions and channel constraints', async () => {
    const response = await request(image);
    expect(response.status).toBe(200);
    const { markdown } = await response.json<{ markdown: string }>();
    const data = JSON.parse(
      markdown.slice('<m-image>'.length, -'</m-image>'.length)
    );
    expect(data).toEqual({
      srcType: 'sfs',
      id: image.staticFileId,
      url: image.url,
      alt: 'Generated image',
      width: 1536,
      height: 1024,
      scale: 1,
      constrainedWidth: 400,
      constrainedHeight: 400,
    });
  });
  it('requires internal authentication', async () => {
    expect((await request(image, false)).status).toBe(401);
  });
  it.each([0, -1, 1.5, 4294967296])(
    'rejects invalid dimensions %s',
    async (width) => {
      expect((await request({ ...image, width })).status).toBe(400);
    }
  );
  it('rejects malformed static file identifiers', async () => {
    expect((await request({ ...image, staticFileId: 'invalid' })).status).toBe(
      400
    );
  });
});
