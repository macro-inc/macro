import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { StaticImage } from '../images/image';
import { ImagesNamespace } from '../images/namespace';
import { MeNamespace } from '../me/namespace';
import { UserNamespace } from './namespace';
import { ExternalProfilePicture } from './profile-picture';
import { User } from './user';

const STATIC_FILES = 'https://static.example';
const ABC = '0190a3c2-0000-7000-8000-000000000abc';
const MINE = '0190a3c2-0000-7000-8000-00000000a1e0';

function makeClient(rows: { id: string; url: string }[]) {
  const calls = { lookups: [] as string[][], puts: [] as string[] };
  const client = {
    hosts: { 'static-files': STATIC_FILES },
    auth: {
      postProfilePictures: async ({
        body,
      }: {
        body: { user_id_list: string[] };
      }) => {
        calls.lookups.push(body.user_id_list);
        return {
          data: {
            pictures: rows.filter((r) => body.user_id_list.includes(r.id)),
          },
        };
      },
      getUserInfo: async () => ({
        data: { user_id: 'macro|me@example.com', permissions: [] },
      }),
      putProfilePictureFile: async ({
        body,
      }: {
        body: { file_id: string };
      }) => {
        calls.puts.push(body.file_id);
        return { data: {} };
      },
    },
  } as unknown as MacroClient;
  return { client, calls };
}

describe('profile pictures', () => {
  test('a static file URL becomes a StaticImage', async () => {
    const { client, calls } = makeClient([
      { id: 'macro|a@example.com', url: `${STATIC_FILES}/file/${ABC}` },
    ]);
    const picture = await User.byId(
      client,
      'macro|a@example.com',
    ).profilePicture();
    expect(picture).toBeInstanceOf(StaticImage);
    expect((picture as StaticImage).id).toBe(ABC);
    expect(calls.lookups).toEqual([['macro|a@example.com']]);
  });

  test('a static file URL on another public base still maps to its file id', async () => {
    const { client } = makeClient([
      {
        id: 'macro|a@example.com',
        url: `https://proxy.example:8443/static-file/file/${ABC}`,
      },
    ]);
    const picture = await User.byId(
      client,
      'macro|a@example.com',
    ).profilePicture();
    expect(picture).toBeInstanceOf(StaticImage);
    expect((picture as StaticImage).id).toBe(ABC);
  });

  test('a legacy URL stays a URL, and no row or empty URL is undefined', async () => {
    const { client } = makeClient([
      { id: 'macro|a@example.com', url: 'https://cdn.example/a.png' },
      { id: 'macro|b@example.com', url: '' },
    ]);
    const legacy = await User.byId(
      client,
      'macro|a@example.com',
    ).profilePicture();
    expect(legacy).toBeInstanceOf(ExternalProfilePicture);
    expect(legacy?.url).toBe('https://cdn.example/a.png');
    expect(
      await User.byId(client, 'macro|b@example.com').profilePicture(),
    ).toBeUndefined();
    expect(
      await User.byId(client, 'macro|c@example.com').profilePicture(),
    ).toBeUndefined();
  });

  test('users.profilePictures batches one request and omits users without one', async () => {
    const { client, calls } = makeClient([
      { id: 'macro|a@example.com', url: `${STATIC_FILES}/file/${ABC}` },
    ]);
    const a = User.byId(client, 'macro|a@example.com');
    const b = User.byId(client, 'macro|b@example.com');
    const pictures = await new UserNamespace(client).profilePictures([a, b]);
    expect(calls.lookups).toHaveLength(1);
    expect(pictures.size).toBe(1);
    expect((pictures.get(a) as StaticImage).id).toBe(ABC);
    expect(pictures.has(b)).toBe(false);
  });

  test('me.profilePicture reads the caller, and update switches to a saved image', async () => {
    const { client, calls } = makeClient([
      { id: 'macro|me@example.com', url: `${STATIC_FILES}/file/${MINE}` },
    ]);
    const me = new MeNamespace(client);
    expect(((await me.profilePicture()) as StaticImage).id).toBe(MINE);
    await me.update({
      profilePicture: new ImagesNamespace(client).byId('earlier'),
    });
    await me.update({ profilePicture: StaticImage.byId(client, 'other') });
    expect(calls.puts).toEqual(['earlier', 'other']);
  });
});
