import { expect, test } from 'bun:test';
import {
  type AgentFace,
  FACE_PARTS,
  parseAgentFace,
  randomFace,
  renderFace,
  resolvedParts,
  shuffle,
} from '../src/index';

test('the same face always renders the same SVG', () => {
  const face: AgentFace = { v: 1, seed: 'k3x9q2', pins: { hair: 12 } };

  expect(renderFace(face)).toBe(renderFace({ ...face, pins: { hair: 12 } }));
});

test('the SVG needs no document: no ids, filters, scripts or links', () => {
  for (const seed of ['ada', 'macro', 'golden-7', 'golden-31', 'golden-64']) {
    const svg = renderFace({ v: 1, seed, pins: {} });

    expect(svg).toStartWith(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"'
    );
    expect(svg).not.toMatch(/\sid=|<filter|<script|<style|url\(|href=/);
  }
});

test('size sets the width and height and changes nothing else', () => {
  const face: AgentFace = { v: 1, seed: 'ada', pins: {} };

  expect(renderFace(face, { size: 256 })).toBe(
    renderFace(face).replace(
      'viewBox="0 0 100 100"',
      'viewBox="0 0 100 100" width="256" height="256"'
    )
  );
});

test('a seed cannot inject markup', () => {
  const svg = renderFace({
    v: 1,
    seed: '"><script>alert(1)</script>',
    pins: {},
  });

  expect(svg).not.toContain('<script');
});

test('a pin outside the options is ignored', () => {
  const plain = renderFace({ v: 1, seed: 'ada', pins: {} });

  expect(renderFace({ v: 1, seed: 'ada', pins: { hair: 99 } })).toBe(plain);
  expect(renderFace({ v: 1, seed: 'ada', pins: { hair: 1.5 } })).toBe(plain);
});

test('randomFace gives a new unpinned face each time', () => {
  const first = randomFace();
  const second = randomFace();

  expect(first.v).toBe(1);
  expect(first.pins).toEqual({});
  expect(first.seed).toMatch(/^[0-9a-z]{8,16}$/);
  expect(second.seed).not.toBe(first.seed);
  expect(parseAgentFace(first)).toEqual(first);
});

test('shuffle changes the seed and keeps the pins', () => {
  const face: AgentFace = { v: 1, seed: 'ada', pins: { hair: 12, glasses: 1 } };

  const shuffled = shuffle(face);

  expect(shuffled.seed).not.toBe('ada');
  expect(shuffled.pins).toEqual({ hair: 12, glasses: 1 });
  expect(shuffled.pins).not.toBe(face.pins);
  expect(face).toEqual({ v: 1, seed: 'ada', pins: { hair: 12, glasses: 1 } });
});

test('parseAgentFace accepts stored JSON and drops unknown top-level keys', () => {
  const stored = JSON.parse(
    '{"v":1,"seed":"k3x9q2","pins":{"hair":12,"background":0},"extra":true}'
  );

  expect(parseAgentFace(stored)).toEqual({
    v: 1,
    seed: 'k3x9q2',
    pins: { hair: 12, background: 0 },
  });
});

test('parseAgentFace rejects anything that is not a version 1 face', () => {
  expect(parseAgentFace(undefined)).toBeUndefined();
  expect(parseAgentFace(null)).toBeUndefined();
  expect(parseAgentFace('{"v":1,"seed":"ada","pins":{}}')).toBeUndefined();
  expect(parseAgentFace([])).toBeUndefined();
  expect(parseAgentFace({ v: 2, seed: 'ada', pins: {} })).toBeUndefined();
  expect(parseAgentFace({ v: '1', seed: 'ada', pins: {} })).toBeUndefined();
  expect(parseAgentFace({ seed: 'ada', pins: {} })).toBeUndefined();
});

test('parseAgentFace rejects a bad seed', () => {
  expect(parseAgentFace({ v: 1, seed: '', pins: {} })).toBeUndefined();
  expect(parseAgentFace({ v: 1, seed: 7, pins: {} })).toBeUndefined();
  expect(
    parseAgentFace({ v: 1, seed: 'x'.repeat(65), pins: {} })
  ).toBeUndefined();
  expect(parseAgentFace({ v: 1, seed: 'x'.repeat(64), pins: {} })).toEqual({
    v: 1,
    seed: 'x'.repeat(64),
    pins: {},
  });
});

test('parseAgentFace rejects bad pins', () => {
  expect(parseAgentFace({ v: 1, seed: 'ada' })).toBeUndefined();
  expect(parseAgentFace({ v: 1, seed: 'ada', pins: null })).toBeUndefined();
  expect(parseAgentFace({ v: 1, seed: 'ada', pins: [1] })).toBeUndefined();
  expect(
    parseAgentFace({ v: 1, seed: 'ada', pins: { tail: 1 } })
  ).toBeUndefined();
  expect(
    parseAgentFace({ v: 1, seed: 'ada', pins: { hair: 'bun' } })
  ).toBeUndefined();
  expect(
    parseAgentFace({ v: 1, seed: 'ada', pins: { hair: 1.5 } })
  ).toBeUndefined();
  expect(
    parseAgentFace({ v: 1, seed: 'ada', pins: { hair: -1 } })
  ).toBeUndefined();
  expect(
    parseAgentFace({ v: 1, seed: 'ada', pins: { hair: 15 } })
  ).toBeUndefined();
  expect(parseAgentFace({ v: 1, seed: 'ada', pins: { hair: 14 } })).toEqual({
    v: 1,
    seed: 'ada',
    pins: { hair: 14 },
  });
});

test('FACE_PARTS lists every part with its number of options', () => {
  const counts = FACE_PARTS.map(({ part, options }) => ({ part, options }));

  expect(counts).toEqual([
    { part: 'head', options: 5 },
    { part: 'skin', options: 8 },
    { part: 'hair', options: 15 },
    { part: 'hairColor', options: 13 },
    { part: 'facialHair', options: 5 },
    { part: 'eyes', options: 7 },
    { part: 'brows', options: 6 },
    { part: 'nose', options: 4 },
    { part: 'mouth', options: 7 },
    { part: 'cheeks', options: 3 },
    { part: 'glasses', options: 4 },
    { part: 'headwear', options: 5 },
    { part: 'earrings', options: 3 },
    { part: 'accent', options: 12 },
    { part: 'shirt', options: 4 },
    { part: 'shirtColor', options: 12 },
    { part: 'background', options: 15 },
  ]);
});

test('only colour parts carry swatches, one colour per option', () => {
  const withSwatches = FACE_PARTS.filter((entry) => entry.swatches);

  expect(withSwatches.map((entry) => entry.part)).toEqual([
    'skin',
    'hairColor',
    'accent',
    'shirtColor',
    'background',
  ]);
  for (const { options, swatches } of withSwatches) {
    expect(swatches).toHaveLength(options);
  }
  expect(FACE_PARTS.find((entry) => entry.part === 'skin')?.swatches).toEqual([
    '#FCE4D2',
    '#F6CFAE',
    '#EDB98A',
    '#DBA06C',
    '#C4875A',
    '#A56B42',
    '#845232',
    '#653E27',
  ]);
});

test('a pinned background swatch is the colour the face is drawn on', () => {
  const svg = renderFace({ v: 1, seed: 'ada', pins: { background: 12 } });
  const navy = FACE_PARTS.find((entry) => entry.part === 'background')
    ?.swatches?.[12];

  expect(navy).toBe('#2E3A66');
  expect(svg).toContain('<rect width="100" height="100" fill="#2E3A66"/>');
});

test('resolvedParts gives the option of every part, pinned or from the seed', () => {
  const face: AgentFace = { v: 1, seed: 'ada', pins: { hair: 12, glasses: 0 } };

  const parts = resolvedParts(face);

  expect(Object.keys(parts)).toEqual(FACE_PARTS.map((entry) => entry.part));
  expect(parts.hair).toBe(12);
  expect(parts.glasses).toBe(0);
  for (const { part, options } of FACE_PARTS) {
    expect(parts[part]).toBeGreaterThanOrEqual(0);
    expect(parts[part]).toBeLessThan(options);
  }
});

test('pinning every part to its resolved option draws the same face', () => {
  for (const seed of ['ada', 'macro', 'golden-7', 'golden-31', 'k3x9q2']) {
    const face: AgentFace = { v: 1, seed, pins: {} };

    const allPinned: AgentFace = { v: 1, seed, pins: resolvedParts(face) };

    expect(renderFace(allPinned)).toBe(renderFace(face));
  }
});

test('a pin outside the options resolves to what the seed chose', () => {
  const fromSeed = resolvedParts({ v: 1, seed: 'ada', pins: {} });

  expect(resolvedParts({ v: 1, seed: 'ada', pins: { hair: 99 } })).toEqual(
    fromSeed
  );
});

test('parseAgentFace counts a seed in characters, as the server does', () => {
  // 64 emoji are 128 UTF-16 units but 64 characters.
  const seed = '🙂'.repeat(64);
  expect(parseAgentFace({ v: 1, seed, pins: {} })).toEqual({
    v: 1,
    seed,
    pins: {},
  });
  expect(
    parseAgentFace({ v: 1, seed: '🙂'.repeat(65), pins: {} })
  ).toBeUndefined();
});

test('a seed with characters XML forbids still draws well-formed SVG', () => {
  const svg = renderFace({ v: 1, seed: 'a\u0001b￾', pins: {} });
  expect(svg).toContain('aria-label="Face ab"');
  // The seed still picks the parts: the same face as before stripping.
  expect(svg).not.toBe(renderFace({ v: 1, seed: 'ab', pins: {} }));
});
