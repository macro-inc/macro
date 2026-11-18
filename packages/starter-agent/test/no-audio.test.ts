// Recordings of people's voices never go in this repository (ENGINEERING.md).
// This checks the repository, not the agent's behavior, so it asks git itself.
import { expect, test } from 'bun:test';

const root = `${import.meta.dir}/..`;
const audio = /\.(wav|mp3|m4a|ogg|flac|opus|webm|pcm)$/i;

test('no tracked file is an audio file', () => {
  const git = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root });
  expect(git.exitCode).toBe(0);
  const tracked = git.stdout.toString().split('\0').filter(Boolean);
  // The listing really is this repository.
  expect(tracked).toContain('ENGINEERING.md');
  expect(tracked.filter((file) => audio.test(file))).toEqual([]);
});
