// C-TOUCH-CARET-MODE-01 part B (design rev 3, v2 bytes): the caret-mode browser
// rows, run once against each engine's build (CARET_ENGINE=source|native)
// through caret.playwright.config.ts (not matched by the *.browser.e2e.ts runs).
// Each row asserts that engine's own expectations and attaches its complete raw
// facts as `caret-facts`; the counted qualifier requires the cross-engine
// equalities. A SETUP or STOP error is never a pass, and every row must reach
// its intended state (no pass by absence).
import { expect, type Page, test } from '@playwright/test';
import catalog from './caret-catalog.json' with { type: 'json' };
import { openCaretPage } from './caret-open';

// v13: narrowed once, so the shared setup (caret-open.ts) receives a definite engine.
const ENGINE: 'source' | 'native' = (() => {
  const value = process.env.CARET_ENGINE;
  if (value !== 'source' && value !== 'native')
    throw new Error('SETUP: set CARET_ENGINE to source or native');
  return value;
})();

/** C-SOURCE-CARET-LOCATION-LOG-01: Source's MarkdownPopup reads the selection
 *  location each time its popup takes a selection, and locationPlugin.ts logs
 *  this (verbatim, typo included) for a collapsed caret. Admitted on the Source
 *  engine only, from the one bound bundle URL (the runner binds it to the Source
 *  build's dist inventory), and counted per row; native admits none. */
const SOURCE_LOCATION_LOG =
  'Currently location plugin only suppotys range selections.';
const SOURCE_LOCATION_LOG_URL = (() => {
  const value = process.env.CARET_SOURCE_LOCATION_LOG_URL;
  if (ENGINE === 'source' && !value)
    throw new Error('SETUP: source rows need CARET_SOURCE_LOCATION_LOG_URL');
  if (ENGINE === 'native' && value !== undefined)
    throw new Error('SETUP: native rows admit no Source location log');
  return value ?? null;
})();

/** PopupPositioner.tsx:28: GeneralizedPopup's default anchor gap. */
const POPUP_GAP = 12;
/** A bounded observation window for rows that expect nothing to show. */
const ABSENCE_WINDOW_MS = 600;

type Point = {
  type: string;
  node: string;
  parent: string;
  text: string | null;
  offset: number;
};
type Facts = {
  engine: string;
  selection: {
    kind: string;
    anchor?: Point;
    focus?: Point;
    nodes?: string[];
  };
  /** Selection/content publications (native) or editor updates (Source). */
  commits: number;
  contentRevision: number;
  generation?: number | null;
  revision?: number;
  paragraphs: string[];
};
type Row = Record<string, unknown>;

// v12: the devices and each row's page params come from ONE catalog, which the
// ready precondition (caret-ready.caret-e2e.ts) and run.py read too.
const DEVICES = catalog.devices;
type Device = (typeof DEVICES)[number];

async function readFacts(page: Page): Promise<Facts> {
  return JSON.parse((await page.locator('#caret-facts').textContent()) || '{}');
}
const thread = async (page: Page) =>
  (await page.locator('#caret-thread').textContent()) ?? '';

/** Opens the caret page with touch set before the app module evaluates
 *  (isTouchDevice.ts samples (pointer: coarse) at load). */
async function open(page: Page, device: Device, params: string, record: Row) {
  // v13: the setup the ready precondition runs too (caret-open.ts).
  await openCaretPage(page, device, params, ENGINE, record);
  // Page-level witnesses, installed before any interaction.
  await page.evaluate(() => {
    const scope = window as unknown as {
      caretSelectionChanges: number;
      caretToolbarShows: number;
      caretToolbarHides: number;
      caretEvents: string[];
    };
    scope.caretSelectionChanges = 0;
    scope.caretToolbarShows = 0;
    scope.caretToolbarHides = 0;
    scope.caretEvents = [];
    document.addEventListener('selectionchange', () => {
      scope.caretSelectionChanges += 1;
      scope.caretEvents.push('selectionchange');
    });
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click'])
      document.addEventListener(
        type,
        (event) =>
          scope.caretEvents.push(
            event instanceof PointerEvent
              ? `${type}:${event.pointerType}:${event.button}`
              : type
          ),
        true
      );
    // Every toolbar node inserted or removed, from the mutation records
    // themselves (a removal and reinsertion in one batch both count).
    const isToolbar = (node: Node) =>
      node instanceof Element &&
      (node.matches('.z-action-menu') ||
        node.querySelector('.z-action-menu') !== null);
    new MutationObserver((records) => {
      for (const mutation of records) {
        for (const node of mutation.addedNodes)
          if (isToolbar(node)) scope.caretToolbarShows += 1;
        for (const node of mutation.removedNodes)
          if (isToolbar(node)) scope.caretToolbarHides += 1;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

const witnesses = (page: Page) =>
  page.evaluate(() => {
    const scope = window as unknown as {
      caretSelectionChanges: number;
      caretToolbarShows: number;
      caretToolbarHides: number;
      caretEvents: string[];
    };
    return {
      selectionChanges: scope.caretSelectionChanges,
      toolbarShows: scope.caretToolbarShows,
      toolbarHides: scope.caretToolbarHides,
      events: scope.caretEvents.slice(),
    };
  });

/** The client point of `offset` within the rendered text `value` (its
 *  character's left edge, vertically centred). */
async function charPoint(page: Page, value: string, offset: number) {
  return page.evaluate(
    ([target, index]) => {
      const body = document.getElementById('body');
      if (!body) throw new Error('SETUP: missing body');
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent !== target) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 1, y: rect.top + rect.height / 2 };
      }
      throw new Error(`SETUP: missing rendered text ${target}`);
    },
    [value, offset] as const
  );
}

async function tapChar(page: Page, value: string, offset: number) {
  const point = await charPoint(page, value, offset);
  await page.touchscreen.tap(point.x, point.y);
  return point;
}

/** A script-only collapsed DOM range in "marked" at 3: no pointer, no mousedown. */
const scriptedMove = (page: Page) =>
  page.evaluate(() => {
    const body = document.getElementById('body');
    const walker = body
      ? document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      : null;
    for (let node = walker?.nextNode(); node; node = walker?.nextNode())
      if (node.textContent === 'marked') {
        document.getSelection()?.setBaseAndExtent(node, 3, node, 3);
        return;
      }
    throw new Error('SETUP: missing marked text');
  });

/** The touch toolbar's visible options, or null when no toolbar renders.
 *  b3: one page function, read by toolbarOptions and by the per-frame sampler. */
const readToolbarOptions = () => {
  const root = document.querySelector('div.relative.touch-pan-y');
  if (!root) return null;
  return [...root.querySelectorAll('button')]
    .filter(
      (button) =>
        !button.closest('[inert], [aria-hidden="true"]') &&
        button.getBoundingClientRect().width > 0 &&
        !['Previous options', 'More options'].includes(
          button.getAttribute('aria-label') ?? ''
        )
    )
    .map((button) => button.textContent?.trim() ?? '');
};

async function toolbarOptions(page: Page) {
  return page.evaluate(readToolbarOptions);
}

/** b3 (diag-hide-03): [ms since `start`, options or null] on EVERY animation
 *  frame until `windowMs` has elapsed, read with readToolbarOptions. */
function sampleToolbar(page: Page, start: number, windowMs: number) {
  return page.evaluate(
    ([from, span, reader]) =>
      new Promise<[number, string[] | null][]>((resolve) => {
        const read = new Function(`return (${reader})()`) as () =>
          | string[]
          | null;
        const out: [number, string[] | null][] = [];
        const step = () => {
          const now = performance.now();
          out.push([now - from, read()]);
          if (now - from < span) requestAnimationFrame(step);
          else resolve(out);
        };
        step();
      }),
    [start, windowMs, readToolbarOptions.toString()] as const
  );
}

/** b3 (t1yg, from diag-hide-03): the hide SHAPE, no ms bound. Present on the
 *  first sample, FIRST absent on a sample before the window ends (b4), and
 *  absent on every sample after it; samples cover the whole window. */
function hideShape(samples: [number, string[] | null][], windowMs: number) {
  const presentAtFirst = samples.length > 0 && samples[0][1] !== null;
  const firstAbsent = samples.find(([, options]) => options === null);
  const firstAbsentMs = firstAbsent ? firstAbsent[0] : null;
  const absentAfter =
    firstAbsentMs !== null &&
    samples.every(([ms, options]) => ms < firstAbsentMs || options === null);
  const lastMs = samples.length > 0 ? samples[samples.length - 1][0] : null;
  return {
    // b4 (t1zr): the FIRST absence must fall inside the window, not on a frame
    // that overshoots it.
    ok:
      presentAtFirst &&
      firstAbsentMs !== null &&
      Number.isFinite(firstAbsentMs) &&
      firstAbsentMs >= 0 &&
      firstAbsentMs < windowMs &&
      absentAfter &&
      lastMs !== null &&
      lastMs >= windowMs,
    presentAtFirst,
    firstAbsentMs,
    absentAfter,
    lastMs,
  };
}

/** The popup pill's raw facts. */
async function pill(page: Page) {
  return page.evaluate(() => {
    const popup = document.querySelector('.z-action-menu');
    if (!popup) return { rendered: false };
    const rect = popup.getBoundingClientRect();
    const row = popup.querySelector('div.relative.touch-pan-y');
    return {
      rendered: true,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      childCount: popup.childElementCount,
      rowChildCount: row?.childElementCount ?? null,
    };
  });
}

async function settledOptions(page: Page, expected: string[]) {
  await expect
    .poll(() => toolbarOptions(page), { timeout: 5000 })
    .toEqual(expected);
}

/** Observes, over a bounded window, that no toolbar renders. */
async function staysAbsent(page: Page) {
  const deadline = Date.now() + ABSENCE_WINDOW_MS;
  while (Date.now() < deadline) {
    expect(await toolbarOptions(page)).toBeNull();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve))
    );
  }
}

/** Waits until selectionchange delivery stops (no new event across two
 *  animation frames), bounded. */
async function selectionSettled(page: Page) {
  let last = -1;
  for (let turn = 0; turn < 40; turn++) {
    const { selectionChanges } = await witnesses(page);
    if (selectionChanges === last) return;
    last = selectionChanges;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
  }
  throw new Error('SETUP: selectionchange delivery did not settle');
}

/** Requires the tap to have reached exactly the intended caret, or STOPs
 *  with the raw resolved selection (never a pass by absence). */
function requireCaret(facts: Facts, text: string, offset: number) {
  const { selection } = facts;
  const exact =
    selection.kind === 'range' &&
    JSON.stringify(selection.anchor) === JSON.stringify(selection.focus) &&
    selection.anchor?.type === 'text' &&
    selection.anchor.text === text &&
    selection.anchor.offset === offset;
  if (!exact)
    throw new Error(
      `STOP: the tap did not reach "${text}" at ${offset}: ${JSON.stringify(selection)}`
    );
}

async function caretRect(page: Page) {
  return page.evaluate(() => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const node = selection.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const computed = element ? getComputedStyle(element).lineHeight : null;
    const parsed = computed === null ? Number.NaN : Number.parseFloat(computed);
    // t1yk: a computed 'normal' line-height parses to NaN; the caret rect's own
    // height is then the line-box bound, and which one was used is recorded.
    const finite = Number.isFinite(parsed);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      computedLineHeight: computed,
      lineBound: finite ? parsed : rect.height,
      lineBoundSource: finite ? 'computed line-height' : 'caret rect height',
    };
  });
}

/** C-TOUCH-CARET-WEBKIT-01 packet B: the Tauri-iOS boundary's recorded IPC log
 *  (index.html), or null on a page without ?ios. */
const ipcLog = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __TAURI_CARET_IPC_LOG__?: unknown[] }
      ).__TAURI_CARET_IPC_LOG__?.slice() ?? null
  );

/** The suppression values the page asked the native edit menu for, in order. */
const suppressions = (log: unknown[] | null) =>
  (log ?? []).flatMap((entry) => {
    const call = entry as { cmd?: string; args?: { suppressed?: unknown } };
    return call.cmd === 'plugin:edit-menu|set_native_menu_suppressed'
      ? [call.args?.suppressed]
      : [];
  });

const activeElement = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    const body = document.getElementById('body');
    return {
      isEditorRoot: active === body,
      insideEditor: body?.contains(active) ?? false,
      tag: active?.tagName ?? null,
      id: active?.id ?? null,
    };
  });

for (const device of DEVICES) {
  /** One row: page errors are collected from before navigation, the complete
   *  record is always attached, and any page error fails the row as SETUP.
   *  v16: the one admitted Source location log is counted, not collected, and
   *  recorded with the row's absolute toolbar-open count (its witness). */
  const caretRow = (
    title: string,
    body: (page: Page, record: Row) => Promise<void>
  ) => {
    const entry = catalog.rows.find((row) => row.title === title);
    if (!entry)
      throw new Error(`SETUP: row ${title} is not in caret-catalog.json`);
    const params = entry.params;
    return test(`${device.name} ${title}`, async ({ page }, info) => {
      const record: Row = { row: title, engine: ENGINE, device: device.name };
      const errors: string[] = [];
      let sourceLocationLogs = 0;
      page.on('pageerror', (error) =>
        errors.push(`pageerror: ${error.message}`)
      );
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (
          ENGINE === 'source' &&
          message.text() === SOURCE_LOCATION_LOG &&
          message.location().url === SOURCE_LOCATION_LOG_URL
        ) {
          sourceLocationLogs += 1;
          return;
        }
        errors.push(`console: ${message.text()} @ ${message.location().url}`);
      });
      let failure: unknown;
      try {
        await open(page, device, params, record);
        await body(page, record);
      } catch (error) {
        failure = error;
      }
      record.pageErrors = errors;
      record.sourceLocationLogs = sourceLocationLogs;
      record.caretToolbarShows = await page
        .evaluate(
          () =>
            (window as unknown as { caretToolbarShows?: number })
              .caretToolbarShows ?? null
        )
        .catch(() => null);
      // b3 (t232 lead 1): the final IPC log is captured here for EVERY row, so a
      // failed row keeps it; null without ?ios, '<unreadable>' if it can't be read.
      record.ipcLog = await ipcLog(page).catch(() => '<unreadable>');
      await info.attach('caret-facts', {
        body: JSON.stringify(record),
        contentType: 'application/json',
      });
      if (failure !== undefined) throw failure;
      if (errors.length > 0)
        throw new Error(`SETUP: page errors ${JSON.stringify(errors)}`);
    });
  };

  test.describe(`${ENGINE} ${device.name}`, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: device.isMobile,
      hasTouch: true,
    });

    for (const placement of [
      { name: 'mid-word', text: 'marked', offset: 3 },
      { name: 'line start', text: 'Lead', offset: 0 },
    ] as const)
      caretRow(
        `caret mode geometry at ${placement.name}`,
        async (page, record) => {
          record.tap = await tapChar(page, placement.text, placement.offset);
          await selectionSettled(page);
          const facts = await readFacts(page);
          record.selection = facts.selection;
          requireCaret(facts, placement.text, placement.offset);
          // The Source rule ($getMarkIdsAtCaret): a text caret whose parent is
          // the comment mark.
          if (facts.selection.anchor?.parent !== 'comment-mark')
            throw new Error(
              `STOP: the caret is not inside the mark: ${JSON.stringify(facts.selection)}`
            );
          await settledOptions(page, ['Show comment']);
          const rect = await caretRect(page);
          record.caretRect = rect;
          if (
            !rect ||
            (rect.x === 0 &&
              rect.y === 0 &&
              rect.width === 0 &&
              rect.height === 0)
          )
            throw new Error('STOP: all-zero caret rect on Chromium');
          if (!Number.isFinite(rect.lineBound) || rect.lineBound <= 0)
            throw new Error(`SETUP: no line-box bound ${JSON.stringify(rect)}`);
          const box = await pill(page);
          record.toolbar = box;
          record.viewport = device.viewport;
          if (!('rect' in box) || !box.rect)
            throw new Error('STOP: toolbar box missing');
          expect(box.rect.width).toBeGreaterThan(0);
          expect(box.rect.height).toBeGreaterThan(0);
          expect(box.rect.x).toBeGreaterThanOrEqual(0);
          expect(box.rect.y).toBeGreaterThanOrEqual(0);
          expect(box.rect.x + box.rect.width).toBeLessThanOrEqual(
            device.viewport.width
          );
          expect(box.rect.y + box.rect.height).toBeLessThanOrEqual(
            device.viewport.height
          );
          const gap = Math.max(
            box.rect.y - (rect.y + rect.height),
            rect.y - (box.rect.y + box.rect.height),
            0
          );
          record.verticalGap = gap;
          expect(gap).toBeLessThanOrEqual(rect.lineBound + POPUP_GAP);
        }
      );

    for (const readonly of [false, true])
      caretRow(
        `id-less mark ${readonly ? 'read-only' : 'with Edit'} renders Source's empty pill`,
        async (page, record) => {
          // Read-only mirrors real access: canEdit false and a non-editable
          // body on both engines.
          expect(record.editable).toBe(!readonly);
          record.tap = await tapChar(page, 'bare', 2);
          await selectionSettled(page);
          const facts = await readFacts(page);
          record.selection = facts.selection;
          requireCaret(facts, 'bare', 2);
          // The jsdom Source control: admitted, an empty pill (no options).
          await expect.poll(() => pill(page)).toMatchObject({ rendered: true });
          await settledOptions(page, []);
          record.pill = await pill(page);
          // Scope omission (named): Chromium has no native edit menu, so the
          // suppression call (setNativeEditMenuSuppressed, iOS only) is not
          // observable here; it is covered by the jsdom rows only.
          record.suppressionCalls =
            'not observable on Chromium (scope omission)';
        }
      );

    caretRow(
      'typing in the mark keeps the caret toolbar',
      async (page, record) => {
        record.tap = await tapChar(page, 'marked', 3);
        await selectionSettled(page);
        requireCaret(await readFacts(page), 'marked', 3);
        await settledOptions(page, ['Show comment']);
        const before = await witnesses(page);
        await page.keyboard.type('xy');
        await expect
          .poll(async () => (await readFacts(page)).paragraphs[0])
          .toBe('Before marxyked after');
        await settledOptions(page, ['Show comment']);
        const after = await witnesses(page);
        record.toolbarHides = after.toolbarHides - before.toolbarHides;
        record.toolbarShows = after.toolbarShows - before.toolbarShows;
        record.selection = (await readFacts(page)).selection;
      }
    );

    caretRow(
      'Show comment moves focus off the editor root',
      async (page, record) => {
        record.tap = await tapChar(page, 'marked', 3);
        await selectionSettled(page);
        requireCaret(await readFacts(page), 'marked', 3);
        await settledOptions(page, ['Show comment']);
        record.selection = (await readFacts(page)).selection;
        record.threadBefore = await thread(page);
        record.beforeTap = await activeElement(page);
        expect(record.beforeTap).toMatchObject({ isEditorRoot: true });
        const option = page
          .getByRole('button', { name: 'Show comment', exact: true })
          .filter({ visible: true });
        const box = await option.boundingBox();
        if (!box) throw new Error('SETUP: Show comment has no box');
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2
        );
        await expect.poll(() => thread(page)).toBe('t1');
        record.threadAfter = await thread(page);
        record.afterActivation = await activeElement(page);
        expect(record.afterActivation).toMatchObject({ isEditorRoot: false });
      }
    );

    caretRow(
      'a DOM-only move from a node selection is not adopted',
      async (page, record) => {
        // HorizontalRule.tsx: its outer div selects the rule on click.
        const rule = page.locator('#body div.relative.my-2.h-10').first();
        const box = await rule.boundingBox();
        if (!box) throw new Error('SETUP: the horizontal rule has no box');
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2
        );
        await selectionSettled(page);
        const selected = await readFacts(page);
        record.ruleSelection = selected.selection;
        if (
          selected.selection.kind !== 'node' ||
          JSON.stringify(selected.selection.nodes) !== '["horizontalrule"]'
        )
          throw new Error(
            `STOP: rule NodeSelection not reachable: ${JSON.stringify(selected.selection)}`
          );
        // events.ts:918-931 (and Lexical's pinned onPointerDown): only a
        // primary NON-touch, non-pen pointerdown outside a decorator sets the
        // mouse-down flag the :790 guard reads. Every pointerdown of the rule
        // tap must be touch, so the flag cannot be set before the scripted move.
        const tap = await witnesses(page);
        record.ruleTapEvents = tap.events;
        const pointerDowns = tap.events.filter((event) =>
          event.startsWith('pointerdown')
        );
        if (
          pointerDowns.length === 0 ||
          pointerDowns.some((event) => !event.startsWith('pointerdown:touch'))
        )
          throw new Error(
            `STOP: the rule tap did not produce only touch pointerdowns: ${JSON.stringify(tap.events)}`
          );
        const before = { facts: await readFacts(page), ...tap };
        record.before = { ...before, active: await activeElement(page) };
        await scriptedMove(page);
        await expect
          .poll(async () => (await witnesses(page)).selectionChanges)
          .toBeGreaterThan(before.selectionChanges);
        await selectionSettled(page);
        await staysAbsent(page);
        const after = await readFacts(page);
        record.after = {
          facts: after,
          ...(await witnesses(page)),
          active: await activeElement(page),
        };
        // Not adopted: the same exact NodeSelection and content on both
        // engines; on native, also no new publication at the same generation
        // and document revision.
        expect(after.selection).toEqual(before.facts.selection);
        expect(after.contentRevision).toBe(before.facts.contentRevision);
        if (ENGINE === 'native') {
          expect(after.commits).toBe(before.facts.commits);
          expect(after.generation).toBe(before.facts.generation);
          expect(after.revision).toBe(before.facts.revision);
        }
      }
    );

    caretRow(
      'the same DOM-only move from a range is adopted',
      async (page, record) => {
        record.tap = await tapChar(page, 'Before ', 2);
        await selectionSettled(page);
        const before = await readFacts(page);
        record.before = before.selection;
        requireCaret(before, 'Before ', 2);
        await scriptedMove(page);
        await expect
          .poll(async () => (await readFacts(page)).selection)
          .toMatchObject({
            kind: 'range',
            anchor: {
              type: 'text',
              text: 'marked',
              offset: 3,
              parent: 'comment-mark',
            },
          });
        await settledOptions(page, ['Show comment']);
        const after = await readFacts(page);
        record.after = {
          facts: after,
          options: await toolbarOptions(page),
          ...(await witnesses(page)),
          thread: await thread(page),
        };
      }
    );

    caretRow(
      'a caret outside any comment shows nothing',
      async (page, record) => {
        record.tap = await tapChar(page, 'Before ', 2);
        await selectionSettled(page);
        const facts = await readFacts(page);
        record.selection = facts.selection;
        requireCaret(facts, 'Before ', 2);
        await staysAbsent(page);
        record.after = await witnesses(page);
      }
    );

    // C-TOUCH-CARET-WEBKIT-01 packet B (?ios: the Tauri-iOS boundary only).
    caretRow(
      'iOS caret mode offers Paste with edit access',
      async (page, record) => {
        record.tap = await tapChar(page, 'marked', 3);
        await selectionSettled(page);
        requireCaret(await readFacts(page), 'marked', 3);
        await settledOptions(page, ['Show comment', 'Paste']);
        record.options = await toolbarOptions(page);
        record.selection = (await readFacts(page)).selection;
      }
    );

    caretRow(
      'iOS caret mode offers no Paste read-only',
      async (page, record) => {
        record.tap = await tapChar(page, 'marked', 3);
        await selectionSettled(page);
        requireCaret(await readFacts(page), 'marked', 3);
        await settledOptions(page, ['Show comment']);
        record.options = await toolbarOptions(page);
        record.selection = (await readFacts(page)).selection;
      }
    );

    caretRow(
      'iOS Paste inserts the pasteboard text at the caret',
      async (page, record) => {
        record.tap = await tapChar(page, 'marked', 3);
        await selectionSettled(page);
        requireCaret(await readFacts(page), 'marked', 3);
        await settledOptions(page, ['Show comment', 'Paste']);
        record.ipcBefore = await ipcLog(page);
        const option = page
          .getByRole('button', { name: 'Paste', exact: true })
          .filter({ visible: true });
        const box = await option.boundingBox();
        if (!box) throw new Error('SETUP: Paste has no box');
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2
        );
        await expect
          .poll(async () => (await readFacts(page)).paragraphs[0])
          .toBe('Before marPBked after');
        const facts = await readFacts(page);
        record.paragraph = facts.paragraphs[0];
        record.selection = facts.selection;
        // b2 (t232, t1yg): where 'PB' landed, for Source == native parity: every
        // DOM text node holding it, whether it sits inside a comment <mark>, that
        // mark's full text, and its element path up to the editor root.
        record.pasteHolders = await page.evaluate(() => {
          const body = document.getElementById('body');
          if (!body) return null;
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          const holders: {
            insideMark: boolean;
            markText: string | null;
            path: string[];
          }[] = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.includes('PB')) continue;
            const mark = node.parentElement?.closest('mark') ?? null;
            const inside = mark !== null && body.contains(mark);
            const path: string[] = [];
            for (
              let element = node.parentElement;
              element && element !== body;
              element = element.parentElement
            )
              path.push(element.tagName.toLowerCase());
            holders.push({
              insideMark: inside,
              markText: inside ? (mark?.textContent ?? null) : null,
              path,
            });
          }
          return holders;
        });
      }
    );

    caretRow(
      'iOS suppression follows the caret toolbar',
      async (page, record) => {
        record.ipcAtLoad = await ipcLog(page);
        record.tap = await tapChar(page, 'marked', 3);
        await selectionSettled(page);
        requireCaret(await readFacts(page), 'marked', 3);
        await settledOptions(page, ['Show comment', 'Paste']);
        record.ipcShown = await ipcLog(page);
        // b3 (diag-hide-03): the hide is MEASURED, not raced against Source's
        // 100 ms trailing debounce: every frame for the window from t0 (just
        // before the tap-away), plus each toolbar removal's time.
        await page.evaluate(() => {
          const scope = window as unknown as { caretHideRemovals: number[] };
          scope.caretHideRemovals = [];
          const isToolbar = (node: Node) =>
            node instanceof Element &&
            (node.matches('.z-action-menu') ||
              node.querySelector('.z-action-menu') !== null);
          new MutationObserver((records) => {
            for (const mutation of records)
              for (const node of mutation.removedNodes)
                if (isToolbar(node))
                  scope.caretHideRemovals.push(performance.now());
          }).observe(document.body, { childList: true, subtree: true });
        });
        const away = await charPoint(page, 'Before ', 2);
        record.tapAway = away;
        const t0 = await page.evaluate(() => performance.now());
        await page.touchscreen.tap(away.x, away.y);
        record.hideSamples = await sampleToolbar(page, t0, ABSENCE_WINDOW_MS);
        record.hideRemovalsMs = await page.evaluate(
          (start) =>
            (
              window as unknown as { caretHideRemovals: number[] }
            ).caretHideRemovals.map((at) => at - start),
          t0
        );
        const shape = hideShape(
          record.hideSamples as [number, string[] | null][],
          ABSENCE_WINDOW_MS
        );
        record.hideFirstAbsentMs = shape.firstAbsentMs;
        if (!shape.ok)
          throw new Error(
            `the toolbar hide shape failed: ${JSON.stringify(shape)}`
          );
        await selectionSettled(page);
        const facts = await readFacts(page);
        requireCaret(facts, 'Before ', 2);
        record.selection = facts.selection;
        const after = await ipcLog(page);
        record.suppressedAtLoad = suppressions(record.ipcAtLoad as unknown[]);
        record.suppressedShown = suppressions(record.ipcShown as unknown[]);
        record.suppressedHidden = suppressions(after);
      }
    );
  });
}
