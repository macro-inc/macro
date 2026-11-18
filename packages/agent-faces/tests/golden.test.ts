import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { type AgentFace, FACE_PARTS, renderFace } from '../src/index';
import hashes from './golden/hashes.json';

// Saved faces are stored as seed + pins, so the drawing for a given AgentFace
// must never change. These files were produced by the original playground code
// (agent-avatars/public/face). If a golden fails, the change alters saved
// faces: revert it, or introduce a new `v` and keep v1 drawing as it does.

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

const golden = (name: string) =>
  Bun.file(new URL(`./golden/${name}.svg`, import.meta.url)).text();

test('seed "ada" draws the golden SVG', async () => {
  const face: AgentFace = { v: 1, seed: 'ada', pins: {} };

  expect(`${renderFace(face)}\n`).toBe(await golden('ada'));
});

test('seed "macro" draws the golden SVG', async () => {
  const face: AgentFace = { v: 1, seed: 'macro', pins: {} };

  expect(`${renderFace(face)}\n`).toBe(await golden('macro'));
});

test('seed "golden-7" draws the golden SVG', async () => {
  const face: AgentFace = { v: 1, seed: 'golden-7', pins: {} };

  expect(`${renderFace(face)}\n`).toBe(await golden('golden-7'));
});

test('seed "k3x9q2" draws the golden SVG', async () => {
  const face: AgentFace = { v: 1, seed: 'k3x9q2', pins: {} };

  expect(`${renderFace(face)}\n`).toBe(await golden('k3x9q2'));
});

test('pinned hair, glasses, headwear and background draw the golden SVG', async () => {
  const face: AgentFace = {
    v: 1,
    seed: 'ada',
    pins: { hair: 12, glasses: 1, headwear: 4, background: 12 },
  };

  expect(`${renderFace(face)}\n`).toBe(await golden('ada-pinned'));
});

test('a headscarf with a pinned beard and turtleneck draws the golden SVG', async () => {
  const face: AgentFace = {
    v: 1,
    seed: 'macro',
    pins: { headwear: 3, facialHair: 4, shirt: 2 },
  };

  expect(`${renderFace(face)}\n`).toBe(await golden('macro-headscarf-beard'));
});

test('105 seeds draw exactly what the playground drew', () => {
  const drawn = Object.fromEntries(
    Object.keys(hashes.seeds).map((seed) => [
      seed,
      sha256(renderFace({ v: 1, seed, pins: {} })),
    ])
  );

  expect(drawn).toEqual(hashes.seeds);
});

test('every option of every part draws exactly what the playground drew', () => {
  const drawn: Record<string, string> = {};
  for (const { part, options } of FACE_PARTS) {
    for (let option = 0; option < options; option++) {
      const face: AgentFace = {
        v: 1,
        seed: 'golden',
        pins: { [part]: option },
      };
      drawn[`${part}:${option}`] = sha256(renderFace(face));
    }
  }

  expect(drawn).toEqual(hashes.pinned);
});
