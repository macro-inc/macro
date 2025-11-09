import type { ColorBlock } from '@block-color/type/ColorBlock';
// import { parseOklch } from '@block-color/util/oklch';

/* -------------------------------------------------- */
/* PETER I HAD TO CHANG THE THEME SPEC */
/* VERY SORRY FOR BREAKING COLOR BLOCK */
/* NEW THEME SPEC IS IN themeUtil.ts */
/* IT LOOKS LIKE: */

// export type ThemeV1Tokens = {
//   a0: { l: number; c: number; h: number };
//   a1: { l: number; c: number; h: number };
//   a2: { l: number; c: number; h: number };
//   a3: { l: number; c: number; h: number };
//   a4: { l: number; c: number; h: number };
//   b0: { l: number; c: number; h: number };
//   b1: { l: number; c: number; h: number };
//   b2: { l: number; c: number; h: number };
//   b3: { l: number; c: number; h: number };
//   b4: { l: number; c: number; h: number };
//   c0: { l: number; c: number; h: number };
//   c1: { l: number; c: number; h: number };
//   c2: { l: number; c: number; h: number };
//   c3: { l: number; c: number; h: number };
//   c4: { l: number; c: number; h: number };
// }

// export type ThemeV1 = {
//   id: string;
//   name: string;
//   version: number;
//   tokens: ThemeV1Tokens;
// };
/* -------------------------------------------------- */

// type ValidationResult =
// | { valid: true; spec: ThemeSpecification }
// | { valid: false; errors: string[] };

// const EPS = 1e-3;
// const approxEq = (a: number, b: number) => Math.abs(a - b) <= EPS;

/**
 * Validate a ColorBlock against the ThemeSpecification layout.
 * Columns: [Accent, Contrast, Surface]
 * Rows per column: 5
 * - Accent: row1 => (accent-l, accent-c, accent-h); rows 2-5 => accent-h-1..4 with L and C locked
 * - Contrast: row1 => (contrast-l, contrast-c, contrast-h); rows 2-5 => contrast-l-1..4 with C and H locked
 * - Surface: row1 => (surface-l, surface-c, surface-h); rows 2-5 => surface-l-1..4 with C and H locked
 */
export function validateColorBlockAsTheme(_block: ColorBlock): boolean {
  // const errors: string[] = [];

  // if (block.columns.length !== 3) {
  //   errors.push(
  //     `Expected 3 columns (Accent, Contrast, Surface); received ${block.columns.length}`
  //   );
  // }

  // block.columns.forEach((col, ci) => {
  //   if (col.colors.length !== 5) {
  //     errors.push(
  //       `Column ${ci + 1}: expected 5 rows; received ${col.colors.length}`
  //     );
  //   }
  //   col.colors.forEach((sw, ri) => {
  //     if (!parseOklch(sw.color)) {
  //       errors.push(
  //         `Column ${ci + 1} Row ${ri + 1}: invalid OKLCH color '${sw.color}'`
  //       );
  //     }
  //   });
  // });

  // if (errors.length > 0) {
  //   return { valid: false, errors };
  // }

  // // Safe to parse everything now
  // const accent = block.columns[0].colors.map((s) => parseOklch(s.color)!);
  // const contrast = block.columns[1].colors.map((s) => parseOklch(s.color)!);
  // const surface = block.columns[2].colors.map((s) => parseOklch(s.color)!);

  // // Accent: rows 2-5 must lock L and C to row1
  // for (let i = 1; i < 5; i++) {
  //   if (
  //     !approxEq(accent[i].l, accent[0].l) ||
  //     !approxEq(accent[i].c, accent[0].c)
  //   ) {
  //     errors.push(
  //       `Accent row ${i + 1}: expected same L (${accent[0].l}) and C (${accent[0].c}) as row 1`
  //     );
  //   }
  // }

  // // Contrast: rows 2-5 must lock C and H to row1
  // for (let i = 1; i < 5; i++) {
  //   if (
  //     !approxEq(contrast[i].c, contrast[0].c) ||
  //     !approxEq(contrast[i].h, contrast[0].h)
  //   ) {
  //     errors.push(
  //       `Contrast row ${i + 1}: expected same C (${contrast[0].c}) and H (${contrast[0].h}) as row 1`
  //     );
  //   }
  // }

  // // Surface: rows 2-5 must lock C and H to row1
  // for (let i = 1; i < 5; i++) {
  //   if (
  //     !approxEq(surface[i].c, surface[0].c) ||
  //     !approxEq(surface[i].h, surface[0].h)
  //   ) {
  //     errors.push(
  //       `Surface row ${i + 1}: expected same C (${surface[0].c}) and H (${surface[0].h}) as row 1`
  //     );
  //   }
  // }

  // if (errors.length > 0) {
  //   return { valid: false, errors };
  // }

  // const spec: ThemeSpecification = {
  //   '--accent-l': accent[0].l,
  //   '--accent-c': accent[0].c,
  //   '--accent-h': accent[0].h,
  //   '--accent-h-1': accent[1].h,
  //   '--accent-h-2': accent[2].h,
  //   '--accent-h-3': accent[3].h,
  //   '--accent-h-4': accent[4].h,
  //   '--contrast-l': contrast[0].l,
  //   '--contrast-l-1': contrast[1].l,
  //   '--contrast-l-2': contrast[2].l,
  //   '--contrast-l-3': contrast[3].l,
  //   '--contrast-l-4': contrast[4].l,
  //   '--contrast-c': contrast[0].c,
  //   '--contrast-h': contrast[0].h,
  //   '--surface-l': surface[0].l,
  //   '--surface-l-1': surface[1].l,
  //   '--surface-l-2': surface[2].l,
  //   '--surface-l-3': surface[3].l,
  //   '--surface-l-4': surface[4].l,
  //   '--surface-c': surface[0].c,
  //   '--surface-h': surface[0].h,
  // } as ThemeSpecification;

  return false;
}
