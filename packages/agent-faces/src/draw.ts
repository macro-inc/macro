// Recipe -> SVG string. Square, full bleed, 100 x 100 viewBox. No ids, filters
// or styles, so the result is safe as a data URL or inline, any number of times.

import { distance, lightness, mix } from './color';
import { SIDE_HAIR, stroke } from './parts';
import type { Recipe } from './recipe';

type Point = readonly [number, number];

/** The part of a cubic curve from `t` to its end, as its four control points. */
function curveFrom(
  curve: readonly [Point, Point, Point, Point],
  t: number
): readonly [Point, Point, Point, Point] {
  const between = (a: Point, b: Point): Point => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const a = between(curve[0], curve[1]);
  const b = between(curve[1], curve[2]);
  const c = between(curve[2], curve[3]);
  const d = between(a, b);
  const e = between(b, c);
  return [between(d, e), e, c, curve[3]];
}

/** Whether XML 1.0 allows code point `code` in text. */
const xmlAllows = (code: number) =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  code >= 0x10000;

// A seed may hold characters XML forbids; the label drops them.
const xmlText = (text: string) =>
  Array.from(text)
    .filter((char) => xmlAllows(char.codePointAt(0) ?? 0))
    .join('');

const escapeXml = (text: string) =>
  xmlText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function draw(recipe: Recipe, size: number | undefined): string {
  const shape = recipe.head;
  const widthScale = 1 + 0.07 * recipe.faceWidth;
  const w = shape.halfWidth * widthScale;
  const jawWidth = shape.jawWidth * widthScale;
  const jawY = shape.jawY;
  const chin = shape.chin;
  const left = 50 - w;
  const right = 50 + w;
  const hairScale = w / 26;

  const skin = recipe.skin.hex;
  const darkSkin = lightness(skin) < 0.45;
  const shade = mix(skin, '#3A1408', 0.26);
  const neck = mix(skin, '#3A1408', 0.14);
  const ink = darkSkin ? '#170F0C' : '#2A1F1C';
  const hair = recipe.hairColor.hex;
  const background = recipe.background.hex;
  const cloth = recipe.shirtColor.hex;
  const accent = recipe.accent.hex;
  const accentDark = mix(accent, '#000000', 0.2);

  // Brows follow the hair, but darker when the hair is light or near the skin.
  let brow = hair;
  if (lightness(hair) > 0.5) {
    brow = mix(hair, '#3A2A1E', 0.5);
  } else if (distance(hair, skin) < 110) {
    brow = mix(hair, '#000000', 0.45);
  }

  const eyeX = 11 + 1.6 * recipe.eyeSpacing;
  const eyeSize = 1 + 0.2 * recipe.eyeSize;
  const eyeY = 49;
  const browY =
    eyeY -
    8.6 -
    (recipe.eyes.id === 'wide' ? 1.8 : 0) -
    1.2 * Math.max(0, recipe.eyeSize);
  const noseY = 56.5 + (chin - 78) * 0.4;
  const mouthY = 65.5 + (chin - 78) * 0.6;
  const mouthWidth = 1 + 0.25 * recipe.mouthWidth;

  const headwear = recipe.headwear.id;
  const glasses = recipe.glasses.id;
  const facialHair = recipe.facialHair.id;
  const scarf = headwear === 'headscarf';
  const hat = headwear === 'beanie' || headwear === 'cap';
  const style = recipe.hair;
  const fit = `transform="matrix(${hairScale} 0 0 1 ${50 * (1 - hairScale)} 0)"`;

  // Behind the shoulders.
  let behind = '';
  if (!scarf && style.back) {
    behind += `<g fill="${hair}" ${fit}>${style.back}</g>`;
  }

  // Shoulders and neck.
  const neckline =
    recipe.shirt.id === 'vneck'
      ? 'L50,92.5L59,81.5'
      : 'C44,87.5 56,87.5 59,81.5';
  let body =
    `<path d="M41,64L59,64L59,84C56,89 44,89 41,84Z" fill="${neck}"/>` +
    `<path d="M10,104C10,90 22,83.5 37,82L41,81.5${neckline}L63,82C78,83.5 90,90 90,104Z" fill="${cloth}"/>`;
  if (recipe.shirt.id === 'collar') {
    const flap =
      lightness(cloth) > 0.8
        ? mix(cloth, '#000000', 0.1)
        : mix(cloth, '#ffffff', 0.4);
    body += `<path d="M40.5,80.5L50,88.5L44,94.5L36,83Z M59.5,80.5L50,88.5L56,94.5L64,83Z" fill="${flap}"/>`;
  }
  if (recipe.shirt.id === 'turtleneck') {
    body += `<rect x="39.5" y="75" width="21" height="12" rx="4" fill="${mix(cloth, '#000000', 0.1)}"/>`;
  }

  // The head.
  let head = '';
  if (scarf) {
    head += `<path d="M21,58C14,78 10,96 8,112L92,112C90,96 86,78 79,58Z" fill="${accent}" ${fit}/>`;
  } else {
    for (const side of [-1, 1]) {
      const x = 50 + side * (w + 1.2);
      head += `<circle cx="${x}" cy="51" r="4.9" fill="${skin}"/><circle cx="${x}" cy="51" r="2.2" fill="${shade}" opacity=".4"/>`;
    }
  }
  head += `<path d="M${left},44C${left},27 ${50 - w * 0.66},18 50,18C${50 + w * 0.66},18 ${right},27 ${right},44C${right},${jawY} ${50 + jawWidth},${chin} 50,${chin}C${50 - jawWidth},${chin} ${left},${jawY} ${left},44Z" fill="${skin}"/>`;

  // A beard follows the jaw of whichever head shape is in use: it runs along
  // the jaw curve from the cheek to the chin and back up the other side, then
  // closes over the top lip. A skin patch under the mouth keeps it readable.
  if (facialHair === 'beard' || facialHair === 'stubble') {
    const [a, b, c] = curveFrom(
      [
        [right, 44],
        [right, jawY],
        [50 + jawWidth, chin],
        [50, chin],
      ],
      0.2
    );
    const mirror = ([x, y]: Point) => `${100 - x},${y}`;
    const top = mouthY - 9.5;
    const opacity = facialHair === 'stubble' ? ' opacity=".22"' : '';
    head += `<path d="M${a}C${b} ${c} 50,${chin}C${mirror(c)} ${mirror(b)} ${mirror(a)}C${100 - a[0] + 5},${a[1] + 8} 41,${top} 50,${top}C59,${top} ${a[0] - 5},${a[1] + 8} ${a}Z" fill="${hair}"${opacity}/>`;
    if (facialHair === 'beard') {
      head += `<ellipse cx="50" cy="${mouthY + 1.6}" rx="${9.6 * mouthWidth}" ry="6.2" fill="${skin}"/>`;
    }
  }
  if (facialHair === 'goatee') {
    head +=
      `<path d="M${50 - 9.5 * mouthWidth},${mouthY - 5}Q50,${mouthY - 9} ${50 + 9.5 * mouthWidth},${mouthY - 5}L${50 + 8.5 * mouthWidth},${chin - 3}Q50,${chin + 0.5} ${50 - 8.5 * mouthWidth},${chin - 3}Z" fill="${hair}"/>` +
      `<ellipse cx="50" cy="${mouthY + 1.4}" rx="${7.4 * mouthWidth}" ry="4.6" fill="${skin}"/>`;
  }
  if (facialHair === 'moustache') {
    const y = mouthY - 6.2;
    head += `<path d="M50,${y}C46,${y - 2.4} 39.5,${y - 0.6} 37.5,${y + 4.2}C42.5,${y + 3.4} 47,${y + 3.2} 50,${y + 2}C53,${y + 3.2} 57.5,${y + 3.4} 62.5,${y + 4.2}C60.5,${y - 0.6} 54,${y - 2.4} 50,${y}Z" fill="${hair}"/>`;
  }

  if (recipe.cheeks.id === 'blush') {
    for (const side of [-1, 1]) {
      head += `<circle cx="${50 + side * (eyeX + 6.5)}" cy="${eyeY + 9.5}" r="4.8" fill="#F0606E" opacity="${darkSkin ? 0.36 : 0.3}"/>`;
    }
  } else if (recipe.cheeks.id === 'freckles') {
    for (const side of [-1, 1]) {
      for (const [dx, dy] of [
        [-3, 0],
        [0, 1.7],
        [3, 0],
      ] as const) {
        head += `<circle cx="${50 + side * (eyeX + 3.5) + dx}" cy="${eyeY + 8 + dy}" r="1" fill="${shade}"/>`;
      }
    }
  }

  head += recipe.nose.draw(noseY, shade);
  head += recipe.mouth.draw(mouthY, mouthWidth, ink);
  if (glasses !== 'shades') {
    head +=
      recipe.eyes.draw(50 - eyeX, eyeY, eyeSize, -1, ink) +
      recipe.eyes.draw(50 + eyeX, eyeY, eyeSize, 1, ink);
  }
  head +=
    recipe.brows.draw(50 - eyeX - 0.4, browY, -1, recipe.browTilt, brow) +
    recipe.brows.draw(50 + eyeX + 0.4, browY, 1, recipe.browTilt, brow);

  // Hair over the forehead, then whatever is worn on top of it.
  if (scarf) {
    head += `<path fill-rule="evenodd" d="M19,48C17,22 32,9 50,9C68,9 83,22 81,48C82,62 76,78 66,85L34,85C24,78 18,62 19,48ZM50,23.5C36,23.5 28.5,35 28.5,49C28.5,64 37,75.5 50,75.5C63,75.5 71.5,64 71.5,49C71.5,35 64,23.5 50,23.5Z" fill="${accent}" ${fit}/>`;
  } else if (hat) {
    if (style.front) head += `<g fill="${hair}" ${fit}>${SIDE_HAIR}</g>`;
  } else if (style.front || style.top) {
    head += `<g fill="${hair}" ${fit}>${style.top ?? ''}${style.front ?? ''}</g>`;
  }

  if (glasses !== 'none') {
    const shades = glasses === 'shades';
    const frame = darkSkin ? '#F3EBDD' : '#2A2A30';
    const colour = shades ? '#1E1F26' : frame;
    const leftEye = 50 - eyeX;
    const rightEye = 50 + eyeX;
    const lens = (x: number) => {
      if (glasses === 'round') {
        return `<circle cx="${x}" cy="${eyeY}" r="8.4" fill="#fff" fill-opacity=".22" stroke="${frame}" stroke-width="2.6"/>`;
      }
      const fill = shades ? 'fill="#1E1F26"' : 'fill="#fff" fill-opacity=".22"';
      return `<rect x="${x - 8.8}" y="${eyeY - 6.8}" width="17.6" height="13.6" rx="4.4" ${fill} stroke="${colour}" stroke-width="2.6"/>`;
    };
    head +=
      `<path d="M${leftEye + 8.4},${eyeY - 1}Q50,${eyeY - 4} ${rightEye - 8.4},${eyeY - 1}M${leftEye - 8.6},${eyeY - 1}L${left + 0.5},${eyeY - 3}M${rightEye + 8.6},${eyeY - 1}L${right - 0.5},${eyeY - 3}" ${stroke(colour, 2.6)}/>` +
      lens(leftEye) +
      lens(rightEye);
    if (shades) {
      head += `<path d="M${leftEye - 4.5},${eyeY - 2.5}L${leftEye - 1},${eyeY - 3.6}M${rightEye - 4.5},${eyeY - 2.5}L${rightEye - 1},${eyeY - 3.6}" ${stroke('#fff', 1.6)} opacity=".55"/>`;
    }
  }

  if (!scarf && recipe.earrings.id !== 'none') {
    for (const side of [-1, 1]) {
      const x = 50 + side * (w + 1.8);
      head +=
        recipe.earrings.id === 'studs'
          ? `<circle cx="${x}" cy="56.6" r="2.1" fill="#F2C230"/>`
          : `<circle cx="${x}" cy="59.6" r="3.5" fill="none" stroke="#F2C230" stroke-width="1.9"/>`;
    }
  }

  if (headwear === 'beanie') {
    head += `<g ${fit}><path d="M19.5,35C19,17 33,7.5 50,7.5C67,7.5 81,17 80.5,35Z" fill="${accent}"/><rect x="17.5" y="28.5" width="65" height="11" rx="5.5" fill="${accentDark}"/></g>`;
  } else if (headwear === 'cap') {
    head += `<g ${fit}><path d="M20.5,35C19.5,17 33,8.5 50,8.5C67,8.5 80.5,17 79.5,35Z" fill="${accent}"/><path d="M17.5,34.5C28,30 72,30 82.5,34.5C85,38 81,40.5 76,39.8C60,36.6 40,36.6 24,39.8C19,40.5 15,38 17.5,34.5Z" fill="${accentDark}"/></g>`;
  } else if (headwear === 'headphones') {
    head += `<g ${fit}><path d="M20.5,47C17.5,19 34,6.5 50,6.5C66,6.5 82.5,19 79.5,47" ${stroke('#2B2C34', 4.2)}/><rect x="14" y="41" width="9.5" height="20" rx="4.7" fill="${accent}"/><rect x="76.5" y="41" width="9.5" height="20" rx="4.7" fill="${accent}"/></g>`;
  }

  const turn = `transform="rotate(${5 * recipe.tilt} 50 80)"`;
  const zoom = 1 + 0.08 * recipe.zoom;
  const dimensions =
    size === undefined ? '' : ` width="${size}" height="${size}"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dimensions} role="img" aria-label="Face ${escapeXml(recipe.seed)}">` +
    `<rect width="100" height="100" fill="${background}"/>` +
    `<g transform="matrix(${zoom} 0 0 ${zoom} ${50 * (1 - zoom)} ${62 * (1 - zoom)})">` +
    (behind ? `<g ${turn}>${behind}</g>` : '') +
    body +
    `<g ${turn}>${head}</g>` +
    `</g></svg>`;

  // Trim long decimals: smaller output, and identical in every runtime.
  return svg.replace(/-?\d+\.\d{3,}/g, (number) =>
    String(Number(Number(number).toFixed(2)))
  );
}
