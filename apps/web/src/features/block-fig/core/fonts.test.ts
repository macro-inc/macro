import { describe, expect, it } from 'vitest';
import {
  type CatalogRow,
  facesFor,
  googleCssUrl,
  googleFamilies,
  localFontsFor,
  parseCatalog,
  parseFontFaces,
} from './fonts';

const [roboto, abel, lato] = parseCatalog([
  ['Roboto', 's', '123456789', '123456789', 'wdth:75-100,wght:100-900'],
  ['Abel', 's', '4', '', ''],
  ['Lato', 's', '13479', '13479', ''],
] satisfies CatalogRow[]);

const CSS = `
/* latin-ext */
@font-face {
  font-family: 'Roboto';
  font-style: italic;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/roboto/i-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: italic;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/roboto/i-latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}
/* cyrillic */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/roboto/cyr.woff2) format('woff2');
  unicode-range: U+0400-045F;
}
/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/roboto/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}`;

describe('the Google Fonts catalog', () => {
  it('reads compact rows', () => {
    expect(roboto).toEqual({
      family: 'Roboto',
      category: 'sans-serif',
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      italics: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      axes: [
        ['wdth', 75, 100],
        ['wght', 100, 900],
      ],
    });
    expect(abel.italics).toEqual([]);
    expect(lato.weights).toEqual([100, 300, 400, 700, 900]);
  });

  it('bundles the families, most popular first', async () => {
    const families = await googleFamilies();
    expect(families.length).toBeGreaterThan(1000);
    expect(families.slice(0, 20).map((f) => f.family)).toContain('Roboto');
    expect(families.find((f) => f.family === 'DM Sans')?.axes).toContainEqual([
      'opsz',
      9,
      40,
    ]);
  });

  it('asks for variable axes as ranges, static weights one by one', () => {
    expect(googleCssUrl(roboto)).toBe(
      'https://fonts.googleapis.com/css2?family=Roboto:ital,wdth,wght@0,75..100,100..900;1,75..100,100..900'
    );
    expect(googleCssUrl(abel)).toBe(
      'https://fonts.googleapis.com/css2?family=Abel:wght@400'
    );
    expect(googleCssUrl(lato)).toBe(
      'https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900'
    );
    expect(googleCssUrl(abel, 'Abel')).toBe(
      'https://fonts.googleapis.com/css2?family=Abel:wght@400&text=Abel'
    );
  });
});

describe('font faces', () => {
  const faces = parseFontFaces(CSS);

  it('reads the rules Google answers with', () => {
    expect(faces).toHaveLength(4);
    expect(faces[0]).toEqual({
      family: 'Roboto',
      italic: true,
      weight: [100, 900],
      url: 'https://fonts.gstatic.com/s/roboto/i-ext.woff2',
      unicodeRange: [
        [0x100, 0x2ba],
        [0x1e00, 0x1e9f],
      ],
    });
    expect(
      parseFontFaces(
        "@font-face { font-family: X; src: url('a.ttf'); unicode-range: U+4??; }"
      )[0]
    ).toMatchObject({ weight: [400, 400], unicodeRange: [[0x400, 0x4ff]] });
  });

  it('picks the files a style needs for some text', () => {
    const urls = (style: string, text: string) =>
      facesFor(faces, style, text).map((f) => f.url.split('/').pop());
    expect(urls('Regular', 'Hello')).toEqual(['latin.woff2']);
    expect(urls('Bold', 'Привет')).toEqual(['cyr.woff2', 'latin.woff2']);
    expect(urls('Semi Bold Italic', 'Ąžuolas')).toEqual([
      'i-ext.woff2',
      'i-latin.woff2',
    ]);
  });

  it('falls back to the nearest weight of static files', () => {
    const statics = parseFontFaces(
      ['400', '700']
        .map(
          (w) =>
            `@font-face { font-family: 'Lato'; font-style: normal; font-weight: ${w}; src: url(${w}.woff2); }`
        )
        .join('\n')
    );
    expect(facesFor(statics, 'Black', 'a').map((f) => f.url)).toEqual([
      '700.woff2',
    ]);
    expect(facesFor(statics, 'Medium', 'a').map((f) => f.url)).toEqual([
      '400.woff2',
    ]);
  });
});

describe('local fonts', () => {
  const font = (family: string, style: string) => ({
    family,
    style,
    fullName: `${family} ${style}`,
    postscriptName: `${family}-${style}`.replace(/ /g, ''),
  });
  const fonts = [
    font('Helvetica Neue', 'Bold'),
    font('Helvetica Neue', 'Regular'),
    font('Helvetica Neue', 'Light Italic'),
    font('Helvetica', 'Regular'),
  ];

  it('finds a family, the asked style first', () => {
    const styles = (style: string) =>
      localFontsFor(fonts, 'helvetica neue', style).map((f) => f.style);
    expect(styles('Regular')).toEqual(['Regular', 'Bold', 'Light Italic']);
    expect(styles('Light Italic')[0]).toBe('Light Italic');
    expect(styles('Semi Bold')[0]).toBe('Bold');
    expect(localFontsFor(fonts, 'Arial', 'Regular')).toEqual([]);
  });
});
