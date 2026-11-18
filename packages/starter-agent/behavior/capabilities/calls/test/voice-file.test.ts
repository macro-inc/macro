import { expect, test } from 'bun:test';
import type { Ran } from '../../../context/shell.ts';
import { currentVoiceFile } from '../voice-file.ts';

const ran = (code: number, stdout = ''): Ran => ({ code, stdout, stderr: '' });
const local = '{ "model": "aura-2-thalia-en" }';
const chosen = '{ "model": "aura-2-orion-en" }';

test("a voice Macro committed since the checkout's last pull is the call's voice", async () => {
  const asked: string[][] = [];
  const text = await currentVoiceFile({
    git: async (args) => {
      asked.push([...args]);
      return args[0] === 'fetch' ? ran(0) : ran(0, chosen);
    },
    readLocal: async () => local,
  });
  expect(text).toBe(chosen);
  expect(asked).toEqual([
    ['fetch', '--quiet', 'origin', 'main'],
    ['show', 'refs/remotes/origin/main:config/voice.json'],
  ]);
});

test('without the remote, the checkout has the voice', async () => {
  const text = await currentVoiceFile({
    git: async () => ran(128),
    readLocal: async () => local,
  });
  expect(text).toBe(local);
});

test("a remote main with no voice file keeps the checkout's", async () => {
  const text = await currentVoiceFile({
    git: async (args) => (args[0] === 'fetch' ? ran(0) : ran(128)),
    readLocal: async () => local,
  });
  expect(text).toBe(local);
});

test('a fetch that throws is the checkout too', async () => {
  const text = await currentVoiceFile({
    git: async () => {
      throw new Error('no git');
    },
    readLocal: async () => undefined,
  });
  expect(text).toBeUndefined();
});
