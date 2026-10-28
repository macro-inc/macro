/**
 * Fonts for laying out a document's text, loaded into every engine worker
 * on demand, the way the Figma editor loads them: this computer's fonts
 * once permitted, else Google Fonts (the files covering the text's
 * scripts). Text read from a file keeps its own glyphs until edited, so
 * fonts load for text the engine lays out (edited or new) and when the type
 * tool or the Character panel is about to change it.
 */

import {
  type FontFaceSource,
  facesFor,
  type GoogleFamily,
  googleCssUrl,
  googleFamilies,
  localFontsFor,
  parseFontFaces,
} from '@app/features/block-fig/core/fonts';
import type { AiEngine } from '@core/ai-engine/client';
import type { FontUse } from '@core/ai-engine/types';
import { createSignal } from 'solid-js';
import type { AiFontSource, AiLocalFont } from '../context/ai-editor-context';

export interface FontLoaderOptions {
  engine: AiEngine;
  source?: AiFontSource;
  /** Called after fonts were registered (text should be drawn again). */
  onRegistered: () => void;
  /** The catalog of Google families (the bundled one by default). */
  catalog?: () => Promise<GoogleFamily[]>;
}

const key = (family: string) => family.trim().toLowerCase();

export function createFontLoader(options: FontLoaderOptions) {
  const { engine, source } = options;
  const catalog = options.catalog ?? googleFamilies;
  const [families, setFamilies] = createSignal<GoogleFamily[]>([]);
  const [documentFonts, setDocumentFonts] = createSignal<FontUse[]>([]);
  /** Google stylesheets by family, parsed. */
  const stylesheets = new Map<string, Promise<FontFaceSource[]>>();
  /** Font files fetched and registered (or on their way). */
  const files = new Map<string, Promise<boolean>>();
  /** Families registered from this computer. */
  const local = new Map<string, Promise<boolean>>();
  let catalogLoad: Promise<GoogleFamily[]> | undefined;
  let localFonts: AiLocalFont[] | null | undefined;

  const loadCatalog = () => {
    catalogLoad ??= (async () => {
      try {
        const list = await catalog();
        setFamilies(list);
        return list;
      } catch {
        return [];
      }
    })();
    return catalogLoad;
  };

  const googleFamily = async (family: string) =>
    (await loadCatalog()).find((f) => key(f.family) === key(family));

  /** Re-reads the fonts the document's text uses. */
  const refresh = async () => {
    try {
      setDocumentFonts(await engine.fonts());
    } catch {
      // The engine stopped; the list stays as it was.
    }
  };

  const registerFile = (family: string, url: string): Promise<boolean> => {
    const known = files.get(url);
    if (known) return known;
    const run = (async () => {
      if (!source) return false;
      try {
        const bytes = await source.file(url);
        return (await engine.registerFont(bytes, family)).length > 0;
      } catch {
        files.delete(url);
        return false;
      }
    })();
    files.set(url, run);
    return run;
  };

  const facesOf = (f: GoogleFamily): Promise<FontFaceSource[]> => {
    const k = key(f.family);
    let faces = stylesheets.get(k);
    if (!faces) {
      const load = async (): Promise<FontFaceSource[]> => {
        if (!source) return [];
        try {
          return parseFontFaces(await source.stylesheet(googleCssUrl(f)));
        } catch {
          // Offline: asked again next time.
          stylesheets.delete(k);
          return [];
        }
      };
      faces = load();
      stylesheets.set(k, faces);
    }
    return faces;
  };

  /** The fonts on this computer the person already permitted. */
  const permitted = async (): Promise<AiLocalFont[]> => {
    if (localFonts === undefined) {
      try {
        localFonts = (await source?.grantedLocalFonts?.()) ?? null;
      } catch {
        localFonts = null;
      }
    }
    return localFonts ?? [];
  };

  const registerLocal = (family: string, style: string): Promise<boolean> => {
    const k = key(family);
    const known = local.get(k);
    if (known) return known;
    const run = (async () => {
      let any = false;
      for (const font of localFontsFor(await permitted(), family, style)) {
        try {
          any ||=
            (await engine.registerFont(await font.bytes(), family)).length > 0;
        } catch {
          // An unreadable font: the next one may do.
        }
      }
      return any;
    })();
    local.set(k, run);
    return run;
  };

  /**
   * Loads what `family` in `style` needs to lay out `text`. Resolves to
   * whether the family is now available (Inter always is).
   */
  const ensure = async (
    family: string,
    style: string,
    text = ''
  ): Promise<boolean> => {
    if (key(family) === 'inter') return true;
    if (await registerLocal(family, style)) return true;
    const google = await googleFamily(family);
    if (!google || !source) return false;
    const faces = facesFor(
      (await facesOf(google)).map((f) => ({ ...f, family: google.family })),
      style,
      text
    );
    const loaded = await Promise.all(
      faces.map((f) => registerFile(family, f.url))
    );
    return loaded.some(Boolean);
  };

  /**
   * Loads the fonts of every text the engine lays out; when any arrived,
   * the text is drawn again with them.
   */
  const loadDocumentFonts = async () => {
    await refresh();
    const wanted = documentFonts().filter((f) => f.laidOut);
    const before = files.size + local.size;
    const loaded = await Promise.all(
      wanted.map((f) => ensure(f.family, f.style))
    );
    if (loaded.some(Boolean) && files.size + local.size > before)
      options.onRegistered();
  };

  /** Whether `family` can be loaded (Inter, Google, or this computer). */
  const canLoad = (family: string) =>
    key(family) === 'inter' ||
    families().some((f) => key(f.family) === key(family)) ||
    (localFonts ?? []).some((f) => key(f.family) === key(family));

  /**
   * A CSS family that draws `family`'s name in its own face, for the
   * picker: Google's few-glyph file for the name.
   */
  const previews = new Map<string, Promise<string | undefined>>();
  const preview = (family: string): Promise<string | undefined> => {
    const k = key(family);
    let known = previews.get(k);
    if (!known) {
      const load = async (): Promise<string | undefined> => {
        try {
          const google = await googleFamily(family);
          if (!google || !source)
            return document.fonts.check(`12px "${family}"`)
              ? family
              : undefined;
          const css = await source.stylesheet(
            googleCssUrl(google, google.family)
          );
          const face = parseFontFaces(css)[0];
          if (!face) return undefined;
          const name = `ai-preview ${google.family}`;
          const font = new FontFace(name, `url(${face.url})`);
          await font.load();
          document.fonts.add(font);
          return name;
        } catch {
          return undefined;
        }
      };
      known = load();
      previews.set(k, known);
    }
    return known;
  };

  /** The styles a family offers (its Google weights), for the style menu. */
  const stylesOf = (family: string): string[] => {
    const f = families().find((g) => key(g.family) === key(family));
    if (!f) return ['Regular', 'Italic', 'Bold', 'Bold Italic'];
    const axis = f.axes.find(([tag]) => tag === 'wght');
    const weights = axis
      ? [100, 200, 300, 400, 500, 600, 700, 800, 900].filter(
          (w) => w >= axis[1] && w <= axis[2]
        )
      : f.weights;
    const names: Record<number, string> = {
      100: 'Thin',
      200: 'Extra Light',
      300: 'Light',
      400: 'Regular',
      500: 'Medium',
      600: 'Semi Bold',
      700: 'Bold',
      800: 'Extra Bold',
      900: 'Black',
    };
    const upright = weights.map((w) => names[w] ?? String(w));
    const italic =
      f.italics.length > 0
        ? weights.map((w) => (w === 400 ? 'Italic' : `${names[w] ?? w} Italic`))
        : [];
    return [...upright, ...italic];
  };

  return {
    families,
    documentFonts,
    loadCatalog,
    refresh,
    ensure,
    loadDocumentFonts,
    canLoad,
    preview,
    stylesOf,
  };
}

export type FontLoader = ReturnType<typeof createFontLoader>;
