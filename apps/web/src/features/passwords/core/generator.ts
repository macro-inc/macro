export const CHARACTER_CLASSES = {
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  digits: '23456789',
  symbols: '!@#$%&*+-=?',
} as const;

export type CharacterClass = keyof typeof CHARACTER_CLASSES;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const UINT32_RANGE = 2 ** 32;

/** Uniform index below `size`; rejects the top remainder so no index is favored. */
function uniformIndex(size: number, random: Uint32Array, next: () => number) {
  const limit = UINT32_RANGE - (UINT32_RANGE % size);
  for (;;) {
    const value = random[next()];
    if (value < limit) return value % size;
  }
}

/**
 * A password drawn uniformly from every string of `length` over the selected
 * classes that contains each selected class at least once. Characters are drawn
 * independently and uniformly from the union, and a candidate missing a class is
 * discarded whole, so no position or class is forced.
 */
export function generatePassword(
  length: number,
  classes: readonly CharacterClass[]
) {
  if (
    !Number.isInteger(length) ||
    length < MIN_PASSWORD_LENGTH ||
    length > MAX_PASSWORD_LENGTH
  )
    throw new Error('Invalid password length');
  const selected = [...new Set(classes)];
  if (selected.length === 0) throw new Error('No character classes selected');
  const alphabet = selected.map((name) => CHARACTER_CLASSES[name]).join('');
  for (;;) {
    const random = crypto.getRandomValues(new Uint32Array(length * 2));
    let cursor = 0;
    const next = () => {
      if (cursor === random.length) {
        crypto.getRandomValues(random);
        cursor = 0;
      }
      return cursor++;
    };
    let password = '';
    for (let position = 0; position < length; position++)
      password += alphabet[uniformIndex(alphabet.length, random, next)];
    if (
      selected.every((name) =>
        [...CHARACTER_CLASSES[name]].some((character) =>
          password.includes(character)
        )
      )
    )
      return password;
  }
}
