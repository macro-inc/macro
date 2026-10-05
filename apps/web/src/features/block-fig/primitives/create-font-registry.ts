/**
 * The fonts a design's text is laid out in: which ones the document uses
 * and whether each is available, and loading them into every engine
 * worker on demand, from this computer's fonts (once permitted, as Figma's
 * font helper does) or Google Fonts (the files covering the text's
 * scripts). Text keeps Figma's own layout until edited, so fonts load when
 * text is about to be laid out: entering the text editor, changing a font,
 * styling a range.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type { FontUse } from '@core/fig-engine/types';
import { createSignal } from 'solid-js';
import type {
  FigFontSource,
  LocalFontFile,
} from '../context/fig-viewer-context';
import {
  type FontFaceSource,
  facesFor,
  type GoogleFamily,
  googleCssUrl,
  googleFamilies,
  localFontsFor,
  parseFontFaces,
} from '../core/fonts';

export interface FontRegistryOptions {
  engine: FigEngine;
  source?: FigFontSource;
  /** The catalog of Google families (the bundled one by default). */
  catalog?: () => Promise<GoogleFamily[]>;
}

const key = (family: string) => family.trim().toLowerCase();

export function createFontRegistry(options: FontRegistryOptions) {
  const { engine, source } = options;
  const catalog = options.catalog ?? googleFamilies;
  const [documentFonts, setDocumentFonts] = createSignal<FontUse[]>([]);
  const [families, setFamilies] = createSignal<GoogleFamily[]>([]);
  const [localFonts, setLocalFonts] = createSignal<LocalFontFile[] | null>(
    null
  );
  /** Families loaded (or being loaded) from this computer. */
  const fromLocal = new Map<string, Promise<boolean>>();
  /** Google stylesheets by family, parsed. */
  const stylesheets = new Map<string, Promise<FontFaceSource[]>>();
  /** Font files fetched and registered (or on their way). */
  const files = new Map<string, Promise<boolean>>();
  let catalogLoad: Promise<GoogleFamily[]> | undefined;

  const loadCatalog = () => {
    catalogLoad ??= catalog().then(
      (list) => {
        setFamilies(list);
        return list;
      },
      () => [] as GoogleFamily[]
    );
    return catalogLoad;
  };

  const googleFamily = async (family: string) =>
    (await loadCatalog()).find((f) => key(f.family) === key(family));

  /** Re-reads which fonts the document uses and their status. */
  const refresh = async () => {
    try {
      setDocumentFonts(await engine.fonts());
    } catch {
      // The engine stopped; the list stays as it was.
    }
  };

  const registerLocal = (family: string): Promise<boolean> => {
    const k = key(family);
    const known = fromLocal.get(k);
    if (known) return known;
    const fonts = localFontsFor(localFonts() ?? [], family, '');
    if (fonts.length === 0) return Promise.resolve(false);
    const run = (async () => {
      let any = false;
      for (const font of fonts) {
        try {
          const faces = await engine.registerFont(await font.bytes(), family);
          any ||= faces.length > 0;
        } catch {
          // An unreadable font: the next one may do.
        }
      }
      return any;
    })();
    fromLocal.set(k, run);
    return run;
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
      const load = async () => {
        if (!source) return [];
        return parseFontFaces(await source.stylesheet(googleCssUrl(f)));
      };
      faces = load().catch(() => {
        stylesheets.delete(k);
        return [] as FontFaceSource[];
      });
      stylesheets.set(k, faces);
    }
    return faces;
  };

  /**
   * Loads what `family` in `style` needs to lay out `text`: this
   * computer's font when permitted, else Google's files for the text's
   * scripts. Resolves to whether the family is now registered.
   */
  const ensure = async (
    family: string,
    style: string,
    text = ''
  ): Promise<boolean> => {
    if (key(family) === 'inter') return true;
    if (await registerLocal(family)) return true;
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

  /** Loads every font a text layer's characters use. */
  const ensureAll = async (
    fonts: { family: string; style: string }[],
    text: string
  ) => {
    const results = await Promise.all(
      fonts.map((f) => ensure(f.family, f.style, text))
    );
    if (results.some(Boolean)) await refresh();
  };

  /**
   * Lists this computer's fonts (asking permission: call from a click)
   * and registers the document's families found there.
   */
  const useLocalFonts = async () => {
    if (!source?.localFonts) return;
    setLocalFonts(await source.localFonts());
    fromLocal.clear();
    const used = [...new Set(documentFonts().map((f) => f.family))];
    await Promise.all(used.map((f) => registerLocal(f)));
    await refresh();
  };

  /** Fonts the document uses that neither Google nor this computer has. */
  const missing = () => {
    const google = new Set(families().map((f) => key(f.family)));
    const local = new Set((localFonts() ?? []).map((f) => key(f.family)));
    return documentFonts().filter(
      (f) =>
        f.status === 'MISSING' &&
        !google.has(key(f.family)) &&
        !local.has(key(f.family))
    );
  };

  /** Whether `family` can be loaded (Inter, Google, or this computer). */
  const canLoad = (family: string) =>
    key(family) === 'inter' ||
    families().some((f) => key(f.family) === key(family)) ||
    (localFonts() ?? []).some((f) => key(f.family) === key(family));

  /**
   * A CSS family that draws `family`'s name in its own face, for the
   * picker: Google's few-glyph file for the name, or the installed font.
   */
  const previews = new Map<string, Promise<string | undefined>>();
  const preview = (family: string): Promise<string | undefined> => {
    const k = key(family);
    let known = previews.get(k);
    if (!known) {
      const load = async () => {
        const google = await googleFamily(family);
        if (!google || !source) {
          return document.fonts.check(`12px "${family}"`) ? family : undefined;
        }
        const css = await source.stylesheet(
          googleCssUrl(google, google.family)
        );
        const face = parseFontFaces(css)[0];
        if (!face) return undefined;
        const name = `fig-preview ${google.family}`;
        const font = new FontFace(name, `url(${face.url})`);
        await font.load();
        document.fonts.add(font);
        return name;
      };
      known = load().catch(() => undefined);
      previews.set(k, known);
    }
    return known;
  };

  /** Weights a family offers, when it is a Google family. */
  const weightsOf = (family: string): number[] | undefined => {
    const f = families().find((g) => key(g.family) === key(family));
    if (!f) return undefined;
    const axis = f.axes.find(([tag]) => tag === 'wght');
    if (!axis) return f.weights;
    return [100, 200, 300, 400, 500, 600, 700, 800, 900].filter(
      (w) => w >= axis[1] && w <= axis[2]
    );
  };

  // Local fonts already permitted load without asking again.
  const start = async () => {
    await Promise.all([refresh(), loadCatalog()]);
    const granted = await source?.grantedLocalFonts?.();
    if (granted) setLocalFonts(granted);
  };
  void start();

  return {
    documentFonts,
    /** Google families, once the catalog has loaded. */
    families,
    loadCatalog,
    refresh,
    ensure,
    ensureAll,
    missing,
    canLoad,
    preview,
    weightsOf,
    /** Whether the browser can list this computer's fonts. */
    canUseLocalFonts: () => Boolean(source?.localFonts),
    localFonts,
    useLocalFonts,
  };
}

export type FontRegistry = ReturnType<typeof createFontRegistry>;
