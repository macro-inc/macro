/**
 * Runs one sequence against the build under test and writes down what
 * happened: what each operation did, what each window showed, what the
 * services held, and every place those disagreed. It never stops at a
 * disagreement, so a sequence always ends with the same things recorded and
 * two builds can be compared operation by operation.
 */
import { createHash } from 'node:crypto';
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
} from '@playwright/test';
import type { Api } from '../harness/api';
import { conversationRow } from '../harness/channel';
import { Conversation } from '../harness/messages';
import {
  blockWrites,
  goOffline,
  goOnline,
  loseWriteAnswers,
} from '../harness/network';
import { apiFor, type PersonKey, sessionFile } from '../harness/people';
import { asLines, type HeldMessage, heldMessages } from '../harness/server';
import { findConversations } from '../harness/sidebar';
import {
  type Case,
  describe,
  type Op,
  PREFILL,
  WINDOWS,
  WINS,
  type Win,
  type Windowed,
  type Write,
} from './gen';
import {
  type Act,
  type Key,
  Model,
  type Outcome,
  type Side,
  textOf,
} from './model';

export type Finding = {
  /** What kind of disagreement; `compare.ts` says what each means. */
  kind: string;
  /** The operation it showed at, counted from 0; -1 for the end. */
  step: number;
  detail: string;
};

export type ActRecord = {
  actor: PersonKey;
  what: string;
  /** What this build's model says became of it. */
  outcome: Outcome | 'no target';
  error?: string;
};

export type StepRecord = {
  i: number;
  text: string;
  acts: ActRecord[];
  note?: string;
  ms: number;
};

export type Result = {
  id: string;
  seed: number;
  profile: Case['profile'];
  side: Side;
  /** A fingerprint of the app's page, which differs between the two builds. */
  bundle: string;
  ops: Op[];
  operations: number;
  steps: StepRecord[];
  findings: Finding[];
  end: {
    /** What the services hold. */
    server: string[];
    /** What this build's model says they should hold. */
    model: string[];
    /** What the model of a build that keeps channels on the device says. */
    modelOn: string[];
    groups: Record<Key, number>;
    authors: Record<Key, PersonKey>;
    windows: Record<string, { settled: string[]; reloaded: string[] }>;
  };
  ms: number;
};

type Row = { id: string; lines: string[] };

/**
 * How long a device may take to deliver what it held once it can. A device
 * that was offline sends at once; one whose requests failed while it
 * thought itself connected sends when it next tries.
 */
const RECONNECT_SECONDS = 150;

const PEOPLE: PersonKey[] = ['ada', 'ben', 'cy', 'dee'];

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** The messages with their replies, as blocks that can be compared in any order. */
export function blocks(lines: string[]): string[] {
  const out: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('  > ') && out.length > 0)
      out[out.length - 1].push(line);
    else out.push([line]);
  }
  return out
    .map(([root, ...replies]) => [root, ...replies.sort()].join('\n'))
    .sort();
}

export function sameBlocks(a: string[], b: string[]): boolean {
  return blocks(a).join('\n\n') === blocks(b).join('\n\n');
}

/** What one side has that the other does not, short enough to read. */
export function difference(
  a: string[],
  b: string[],
  nameA: string,
  nameB: string
): string {
  const [blocksA, blocksB] = [blocks(a), blocks(b)];
  const onlyA = blocksA.filter((block) => !blocksB.includes(block));
  const onlyB = blocksB.filter((block) => !blocksA.includes(block));
  const show = (items: string[]) =>
    items
      .slice(0, 6)
      .map((item) => item.replaceAll('\n', ' ⏎'))
      .join(' | ') + (items.length > 6 ? ` | … ${items.length - 6} more` : '');
  if (onlyA.length === 0 && onlyB.length === 0) {
    const at = a.findIndex((line, index) => line !== b[index]);
    return `same messages in another order, from line ${at + 1}: ${nameA} has "${a[at]}", ${nameB} has "${b[at]}"`;
  }
  return `only ${nameA}: ${show(onlyA) || '(nothing)'} ;; only ${nameB}: ${show(onlyB) || '(nothing)'}`;
}

export class Run {
  private readonly ideal: Model;
  private readonly mine: Model;
  private readonly contexts = {} as Record<Windowed, BrowserContext>;
  private readonly views = {} as Record<Win, Conversation>;
  private readonly restorers = new Map<Windowed, () => Promise<void>>();
  private readonly ids = new Map<Key, string>();
  private readonly steps: StepRecord[] = [];
  private readonly findings: Finding[] = [];
  private http!: APIRequestContext;
  private channel!: { id: string; name: string };
  private other!: { id: string; name: string };
  private prefix = '';
  private bundle = '';
  /** Set once the services hold something the model does not expect. */
  private diverged = false;
  private step = 0;

  constructor(
    private readonly browser: Browser,
    private readonly apis: Record<PersonKey, Api>,
    private readonly side: Side,
    private readonly kase: Case & { id: string },
    /** Where a picture of a window is kept when an operation fails in it. */
    private readonly pictures?: string
  ) {
    this.ideal = new Model('on', kase.seed);
    this.mine = side === 'on' ? this.ideal : new Model('off', kase.seed);
  }

  private get models(): Model[] {
    return this.mine === this.ideal ? [this.ideal] : [this.ideal, this.mine];
  }

  private found(kind: string, detail: string, step = this.step): void {
    this.findings.push({ kind, step, detail: detail.slice(0, 1500) });
  }

  private taken = 0;

  private async picture(win: Win): Promise<void> {
    if (!this.pictures) return;
    this.taken += 1;
    await this.views[win].page
      .screenshot({
        path: `${this.pictures}/${this.kase.id}-step${this.step}-${win}-${this.taken}.png`,
      })
      .catch(() => undefined);
  }

  /**
   * Puts a window back on the channel when something left it elsewhere, so
   * that one thing going wrong is not counted again at every later step.
   */
  private async backOnChannel(win: Win): Promise<void> {
    const view = this.views[win];
    if (await view.composer.isVisible()) return;
    if (this.mine.howCut(WINDOWS[win]) === 'offline') return;
    this.found('window was not on the channel', win);
    await view.open().catch(() => undefined);
  }

  // ---- setting the scene ----

  async setUp(): Promise<void> {
    const { seed, profile } = this.kase;
    const members = [this.apis.ben, this.apis.cy, this.apis.dee].map(
      (api) => api.person
    );
    this.prefix = `fz${seed}-${Date.now().toString(36)}`;
    this.channel = await this.apis.ada.createChannel({
      name: `${this.prefix}-main`,
      members,
    });
    this.other = await this.apis.ada.createChannel({
      name: `${this.prefix}-other`,
      members,
    });
    await this.apis.ada.postAll(this.other.id, ['other 1', 'other 2']);

    const count = PREFILL[profile];
    for (let index = 1; index <= count; index += 1) {
      const author = PEOPLE[index % PEOPLE.length];
      await this.prefill(`p${index}`, author, null);
    }
    // A thread near the end, longer than a collapsed thread shows.
    for (let reply = 1; reply <= 5; reply += 1) {
      const author = PEOPLE[reply % PEOPLE.length];
      await this.prefill(`p${count + reply}`, author, `p${count - 2}`);
    }

    this.http = await apiFor('dee');
    const page = await this.http.get('/app/');
    this.bundle = createHash('sha1')
      .update(await page.text())
      .digest('hex')
      .slice(0, 12);

    for (const person of ['ada', 'ben', 'cy'] as const) {
      this.contexts[person] = await this.browser.newContext({
        storageState: sessionFile(person),
      });
    }
    for (const win of WINS) {
      const context = this.contexts[WINDOWS[win]];
      const view = new Conversation(await context.newPage(), this.channel.id);
      view.page.setDefaultTimeout(10_000);
      this.views[win] = view;
    }
    // Each person reads the other channel once, so a device that keeps
    // channels holds it when it is opened with no connection.
    for (const win of ['a1', 'b1', 'c1'] as const) {
      const other = new Conversation(this.views[win].page, this.other.id);
      await other.open();
      await expect(other.message('other 2')).toBeVisible({ timeout: 30_000 });
    }
    await Promise.all(WINS.map((win) => this.views[win].open()));
  }

  private async prefill(
    key: Key,
    author: PersonKey,
    parent: Key | null
  ): Promise<void> {
    const sent = await this.apis[author].post(
      this.channel.id,
      textOf(this.kase.seed, key, 0),
      { threadId: parent ? this.ids.get(parent) : undefined }
    );
    this.ids.set(key, sent.id);
    for (const model of this.models) model.prefill(key, author, parent);
  }

  // ---- reading the services and the windows ----

  private async held(): Promise<HeldMessage[]> {
    const messages = await heldMessages(this.http, this.channel.id);
    const token = new RegExp(`^q${this.kase.seed}([mp]\\d+) v`);
    for (const message of messages.flatMap((root) => [root, ...root.replies])) {
      const key = token.exec(message.line)?.[1];
      if (key) this.ids.set(key, message.id);
    }
    return messages;
  }

  private async serverLines(): Promise<string[]> {
    return asLines(await this.held());
  }

  private async idOf(key: Key): Promise<string> {
    if (!this.ids.has(key)) await this.held();
    const id = this.ids.get(key);
    if (!id) throw new Error(`the services hold no message ${key}`);
    return id;
  }

  /** The rows now drawn in the window, each once every message has its text. */
  private async rows(view: Conversation): Promise<Row[]> {
    let rows: Row[] = [];
    for (let attempt = 0; attempt < 15; attempt += 1) {
      rows = await view.list
        .locator('[data-channel-thread-row]')
        .evaluateAll((elements) =>
          elements.flatMap((row) => {
            const messages = Array.from(row.querySelectorAll('[data-message]'));
            if (messages.length === 0) return [];
            const lines = messages.map((message, index) => {
              const content =
                message.querySelector('[data-message-content]') ??
                message.querySelector('[data-message-slot="content"]');
              const text = (content?.textContent ?? '').trim();
              const reactions = Array.from(
                message.querySelectorAll('[data-message-reaction-chip]')
              )
                .map((chip) => {
                  const emoji = chip.getAttribute('data-emoji') ?? '';
                  const count = (chip.textContent ?? '')
                    .replace(emoji, '')
                    .trim();
                  return count ? `${emoji} ${count}` : emoji;
                })
                .sort();
              const body =
                reactions.length > 0
                  ? `${text} [${reactions.join(' ')}]`
                  : text;
              return index === 0 ? body : `  > ${body}`;
            });
            return [
              {
                id: messages[0].getAttribute('data-message-id') ?? lines[0],
                lines,
              },
            ];
          })
        );
      const blank = rows.some((row) =>
        row.lines.some((line) => line.replace('  > ', '').trim() === '')
      );
      if (!blank) return rows;
      await pause(100);
    }
    return rows;
  }

  private async expandThreads(view: Conversation): Promise<void> {
    const collapsed = view.list.getByTitle('Expand thread');
    for (let turn = 0; turn < 12; turn += 1) {
      if ((await collapsed.count()) === 0) return;
      try {
        await collapsed.first().click({ timeout: 2000 });
      } catch {
        return;
      }
      await pause(80);
    }
  }

  private async toBottom(view: Conversation): Promise<void> {
    const button = view.page.getByRole('button', { name: 'Scroll to bottom' });
    for (let turn = 0; turn < 8; turn += 1) {
      if ((await view.distanceFromBottom()) <= 2) return;
      if (await button.isVisible()) await button.click().catch(() => undefined);
      else await view.wheel(100_000);
      await pause(200);
    }
  }

  /**
   * The whole channel as the window shows it, read as a person reads it:
   * from its first message down, every thread opened. Ends at the newest
   * message.
   */
  private async readWhole(view: Conversation): Promise<string[]> {
    let still = 0;
    let before = '';
    for (let turn = 0; turn < 80 && still < 5; turn += 1) {
      await view.wheel(-3000);
      await pause(200);
      const now = await view.list.evaluate(
        (list) =>
          `${list.scrollTop}/${list.scrollHeight}/${list.querySelector('[data-message]')?.getAttribute('data-message-id')}`
      );
      still = now === before ? still + 1 : 0;
      before = now;
    }
    const order: string[] = [];
    const seen = new Map<string, string[]>();
    const note = async () => {
      await this.expandThreads(view);
      for (const row of await this.rows(view)) {
        if (!seen.has(row.id)) order.push(row.id);
        seen.set(row.id, row.lines);
      }
    };
    for (let turn = 0; turn < 200; turn += 1) {
      await note();
      if ((await view.distanceFromBottom()) <= 2) break;
      await view.wheel(450);
      await pause(120);
    }
    await pause(150);
    await note();
    return order.flatMap((id) => seen.get(id) ?? []);
  }

  /**
   * Reads the window until it shows what it should, or time is up. A window
   * of a connected person should show what the services hold, in their
   * order; a window of a person cut off, what the model says they see.
   */
  private async readUntilRight(
    win: Win,
    seconds: number
  ): Promise<{ lines: string[]; wrong?: string }> {
    const view = this.views[win];
    const person = WINDOWS[win];
    const deadline = Date.now() + seconds * 1000;
    let lines: string[] = [];
    let wrong = '';
    for (;;) {
      try {
        if (WINDOWS[win] === 'ada') await view.page.bringToFront();
        lines = await this.readWhole(view);
        if (this.mine.howCut(person)) {
          const expected = this.mine.lines(person);
          if (sameBlocks(lines, expected)) return { lines };
          wrong = difference(lines, expected, 'window', 'model');
        } else {
          const server = await this.serverLines();
          if (lines.join('\n') === server.join('\n')) return { lines };
          wrong = difference(lines, server, 'window', 'services');
        }
      } catch (error) {
        wrong = `could not be read: ${String(error).split('\n')[0]}`;
      }
      if (Date.now() > deadline) {
        await this.picture(win);
        return { lines, wrong };
      }
      await pause(1000);
    }
  }

  /** Waits for the services to hold what the model says they should. */
  private async delivered(seconds: number, kind: string): Promise<void> {
    if (this.diverged) {
      await pause(2000);
      return;
    }
    const deadline = Date.now() + seconds * 1000;
    let server: string[] = [];
    for (;;) {
      server = await this.serverLines();
      if (sameBlocks(server, this.mine.lines())) return;
      if (Date.now() > deadline) break;
      await pause(400);
    }
    this.diverged = true;
    this.found(
      kind,
      difference(server, this.mine.lines(), 'services', 'model')
    );
  }

  // ---- what a person does in a window ----

  /** The text of a message, wherever it is drawn inside what holds it. */
  private textOf(view: Conversation, key: Key) {
    return view.page
      .locator('[data-message-content], [data-message-slot="content"]')
      .getByText(new RegExp(`^q${this.kase.seed}${key} v\\d+`));
  }

  private locate(view: Conversation, key: Key) {
    return view.list
      .locator('[data-message]')
      .filter({ has: this.textOf(view, key) })
      .last();
  }

  /** Brings a message into the window, opening its thread if it is a reply. */
  private async reveal(view: Conversation, key: Key, parent: Key | null) {
    const target = this.locate(view, key);
    if ((await target.count()) === 0) {
      await this.toBottom(view);
      const anchor = this.locate(view, parent ?? key);
      for (let turn = 0; turn < 30; turn += 1) {
        if ((await anchor.count()) > 0) break;
        await view.wheel(-500);
        await pause(120);
      }
      if (parent && (await target.count()) === 0) {
        // A press on a thread that has only just been drawn can do nothing.
        const expand = view.list
          .locator('[data-channel-thread-row]')
          .filter({ has: this.textOf(view, parent) })
          .getByTitle('Expand thread');
        for (let turn = 0; turn < 6; turn += 1) {
          if ((await target.count()) > 0 || (await expand.count()) === 0) break;
          await expand
            .first()
            .click({ timeout: 2000 })
            .catch(() => undefined);
          await pause(500);
        }
        // A deleted message has no text to find its thread by.
        if ((await target.count()) === 0) await this.readWhole(view);
      }
    }
    await expect(target).toBeVisible({ timeout: 8000 });
    await target.scrollIntoViewIfNeeded();
    return target;
  }

  /**
   * Presses one of the buttons that show when the pointer is over a message.
   * The list moves under the pointer when someone else writes, so the
   * pointer is put back on the message until the press lands.
   */
  private async press(
    message: Locator,
    button: (actions: Locator) => Locator
  ): Promise<void> {
    await expect(async () => {
      await message.scrollIntoViewIfNeeded({ timeout: 2000 });
      await message.hover({ timeout: 2000 });
      await button(message.locator('[data-message-hover-actions]')).click({
        timeout: 1500,
      });
    }).toPass({ timeout: 15_000 });
  }

  private async inWindow(
    win: Win,
    act: Act,
    parent: Key | null
  ): Promise<void> {
    const view = this.views[win];
    const { seed } = this.kase;
    const named = (name: string) => (actions: Locator) =>
      actions.locator(`[data-message-action="${name}"]`);
    await view.page.bringToFront();
    if (act.k === 'send' && act.parent === null) {
      // A build that puts a message that failed back in the box leaves it
      // there for the next one: the box is emptied first.
      await view.composerText.click();
      await view.retype(textOf(seed, act.key, 0));
      await view.page.keyboard.press('Enter');
      return;
    }
    if (act.k === 'send') {
      const root = await this.reveal(view, act.parent as Key, null);
      const id = (await root.getAttribute('data-message-id')) ?? '';
      await this.press(root, named('reply'));
      const composer = view.replyComposer(id);
      await expect(composer).toBeVisible({ timeout: 8000 });
      await composer.click();
      await view.retype(textOf(seed, act.key, 0));
      await view.page.keyboard.press('Enter');
      return;
    }
    const message = await this.reveal(view, act.target, parent);
    if (act.k === 'react') {
      await this.press(message, (actions) =>
        actions.getByRole('button', { name: `React ${act.emoji}` })
      );
      return;
    }
    if (act.k === 'delete') {
      await this.press(message, named('delete'));
      await view.deleteDialog.getByRole('button', { name: 'Delete' }).click();
      return;
    }
    const id = (await message.getAttribute('data-message-id')) ?? '';
    await this.press(message, named('edit'));
    await expect(view.editor(id)).toBeFocused({ timeout: 8000 });
    await view.retype(textOf(seed, act.target, act.version));
    await view.page.keyboard.press('Enter');
  }

  private async throughServices(act: Act, had: boolean): Promise<void> {
    const api = this.apis[act.actor];
    const { seed } = this.kase;
    if (act.k === 'send') {
      const sent = await api.post(this.channel.id, textOf(seed, act.key, 0), {
        threadId: act.parent ? await this.idOf(act.parent) : undefined,
      });
      this.ids.set(act.key, sent.id);
      return;
    }
    const id = await this.idOf(act.target);
    if (act.k === 'edit') {
      await api.edit(
        this.channel.id,
        id,
        textOf(seed, act.target, act.version)
      );
    } else if (act.k === 'delete') {
      await api.remove(this.channel.id, id);
    } else {
      await api.react(this.channel.id, id, act.emoji, !had);
    }
  }

  /** Chooses what the operation acts on, by what the person would see. */
  private resolve(op: Write): { act?: Act; win?: Win; what: string } {
    const win = 'w' in op ? op.w : undefined;
    const actor: PersonKey = win ? WINDOWS[win] : 'dee';
    const what = describe(op);
    const choose = (
      kind: 'reply' | 'edit' | 'delete' | 'react',
      pick: number
    ) => {
      const candidates = this.ideal.candidates(actor, kind, !win);
      return candidates.length > 0
        ? candidates[pick % candidates.length]
        : undefined;
    };
    if (op.k === 'send' || op.k === 'apiSend') {
      return {
        act: { k: 'send', actor, key: `m${op.n}`, parent: null },
        win,
        what,
      };
    }
    if (op.k === 'reply' || op.k === 'apiReply') {
      const parent = choose('reply', op.pick);
      return {
        act: parent ? { k: 'send', actor, key: `m${op.n}`, parent } : undefined,
        win,
        what,
      };
    }
    if (op.k === 'edit' || op.k === 'apiEdit') {
      const target = choose('edit', op.pick);
      return {
        act: target ? { k: 'edit', actor, target, version: op.n } : undefined,
        win,
        what,
      };
    }
    if (op.k === 'delete' || op.k === 'apiDelete') {
      const target = choose('delete', op.pick);
      return {
        act: target ? { k: 'delete', actor, target } : undefined,
        win,
        what,
      };
    }
    const target = choose('react', op.pick);
    return {
      act: target ? { k: 'react', actor, target, emoji: op.emoji } : undefined,
      win,
      what,
    };
  }

  private async writes(
    ops: Write[],
    // Writes started beside a reconnection are waited for with what the
    // device held, which takes longer.
    reconnecting = false
  ): Promise<ActRecord[]> {
    const group = this.step + 1;
    // Everything is chosen before anything is done, so that operations made
    // at once choose from the same channel.
    const chosen = ops.map((op) => this.resolve(op));
    const planned = chosen.map(({ act, win, what }) => {
      if (!act) {
        return {
          record: { actor: 'dee', what, outcome: 'no target' } as ActRecord,
        };
      }
      const had =
        act.k === 'react' &&
        this.mine.hasReacted(act.actor, act.target, act.emoji);
      // Read before the models take the write: a deleted reply has no
      // thread to be looked for in afterwards.
      const parent =
        act.k === 'send'
          ? null
          : (this.mine.message(act.actor, act.target)?.parent ?? null);
      let outcome: Outcome = 'skipped';
      for (const model of this.models) {
        const result = model.write(act, group);
        if (model === this.mine) outcome = result;
      }
      const target = act.k === 'send' ? (act.parent ?? '') : act.target;
      const record: ActRecord = {
        actor: act.actor,
        what: `${what} → ${act.k === 'send' ? act.key : act.k}${target ? ` on ${target}` : ''}`,
        outcome,
      };
      return { record, act, win, had, parent };
    });

    await Promise.all(
      planned.map(async ({ record, act, win, had, parent }) => {
        if (!act || record.outcome === 'skipped') return;
        try {
          if (win) await this.inWindow(win, act, parent ?? null);
          else await this.throughServices(act, had ?? false);
        } catch (error) {
          record.error = String(error).split('\n').slice(0, 3).join(' ');
          this.found('operation failed', `${record.what}: ${record.error}`);
          if (win) {
            await this.picture(win);
            const { page } = this.views[win];
            await page.keyboard.press('Escape').catch(() => undefined);
            await page.keyboard.press('Escape').catch(() => undefined);
          }
        }
      })
    );

    const outcomes = planned.map((plan) => plan.record.outcome);
    if (outcomes.includes('applied') && !reconnecting) {
      await this.delivered(20, 'write not delivered');
    }
    for (const { record, act, win } of planned) {
      if (!act || !win || record.error) continue;
      if (act.k !== 'send' || act.parent !== null) continue;
      if (record.outcome !== 'queued' && record.outcome !== 'applied') continue;
      // A message a person sends is on their screen, sent or waiting. The
      // list draws only the rows near where it is scrolled to, so one that
      // is not drawn was not brought into view.
      const view = this.views[win];
      const shown = this.locate(view, act.key);
      try {
        await expect(shown).toBeVisible({ timeout: 4000 });
      } catch {
        await this.toBottom(view).catch(() => undefined);
        try {
          await expect(shown).toBeVisible({ timeout: 4000 });
          this.found(
            'own message not brought into view',
            `${record.what} (${record.outcome === 'queued' ? 'waiting' : 'sent'})`
          );
        } catch {
          if (record.outcome === 'queued') {
            this.found('waiting write not shown', record.what);
            await this.picture(win);
          }
        }
      }
    }
    if (
      outcomes.some((outcome) => outcome === 'queued' || outcome === 'dropped')
    ) {
      await pause(700);
    }
    return planned.map((plan) => plan.record);
  }

  // ---- everything else a sequence does ----

  private async cut(person: Windowed, how: 'offline' | 'block' | 'lossy') {
    if (this.restorers.has(person)) return 'already cut off';
    const context = this.contexts[person];
    if (how === 'offline') {
      await goOffline(context);
      this.restorers.set(person, () => goOnline(context));
    } else if (how === 'block') {
      this.restorers.set(person, await blockWrites(context));
    } else {
      this.restorers.set(person, await loseWriteAnswers(context));
    }
    for (const model of this.models) model.cut(person, how);
    return undefined;
  }

  private async restore(person: Windowed): Promise<string | undefined> {
    const restorer = this.restorers.get(person);
    if (!restorer) return 'not cut off';
    this.restorers.delete(person);
    await restorer();
    for (const model of this.models) model.restore(person, this.step + 1);
    for (const win of WINS) {
      if (WINDOWS[win] === person) await this.backOnChannel(win);
    }
    return undefined;
  }

  /** Whether the rows drawn are one unbroken run of what the services hold. */
  private async unbroken(win: Win, kind: string): Promise<void> {
    const view = this.views[win];
    const deadline = Date.now() + 8000;
    let wrong = '';
    for (;;) {
      const drawn = (await this.rows(view)).map((row) => row.id);
      const held = (await this.held()).map((message) => message.id);
      const first = held.indexOf(drawn[0]);
      const expected = held.slice(first, first + drawn.length);
      if (
        drawn.length > 0 &&
        first !== -1 &&
        drawn.join() === expected.join()
      ) {
        return;
      }
      wrong = `the window draws ${drawn.length} rows from row ${first + 1} of ${held.length}; ${drawn.filter((id) => !held.includes(id)).length} are not held by the services, and the run breaks at row ${drawn.findIndex((id, index) => id !== expected[index]) + 1}`;
      if (Date.now() > deadline) break;
      await pause(500);
    }
    this.found(kind, `${win}: ${wrong}`);
  }

  private async visit(win: Win): Promise<string | undefined> {
    const view = this.views[win];
    const { page } = view;
    const offline = this.mine.howCut(WINDOWS[win]) === 'offline';
    if (offline && this.side === 'off') {
      return 'not done: a build that keeps nothing has no other channel to show offline';
    }
    await page.bringToFront();
    const rows = [this.other, this.channel].map((channel) =>
      conversationRow(page, channel.name)
    );
    if (!(await rows[0].isVisible()) || !(await rows[1].isVisible())) {
      if (this.mine.howCut(WINDOWS[win]) === 'offline') {
        return 'the channels are not in the list and the list cannot be searched offline';
      }
      await findConversations(page, this.prefix);
      await expect(rows[0]).toBeVisible();
      await expect(rows[1]).toBeVisible();
    }
    await rows[0].click();
    try {
      await expect(new Conversation(page, this.other.id).composer).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await rows[1].click();
    }
    await view.shown();
    return undefined;
  }

  private async one(op: Op): Promise<{ acts?: ActRecord[]; note?: string }> {
    switch (op.k) {
      case 'par': {
        const restores = op.ops.filter((part) => part.k === 'restore');
        const writes = op.ops.filter(
          (part): part is Write => part.k !== 'restore'
        );
        const [notes, acts] = await Promise.all([
          Promise.all(
            restores.map((part) =>
              part.k === 'restore' ? this.restore(part.p) : undefined
            )
          ),
          this.writes(writes, restores.length > 0),
        ]);
        if (restores.length > 0) {
          await this.delivered(
            RECONNECT_SECONDS,
            'not delivered after reconnecting'
          );
        }
        return { acts, note: notes.filter(Boolean).join('; ') || undefined };
      }
      case 'cut':
        return { note: await this.cut(op.p, op.how) };
      case 'restore': {
        const note = await this.restore(op.p);
        if (!note)
          await this.delivered(
            RECONNECT_SECONDS,
            'not delivered after reconnecting'
          );
        return { note };
      }
      case 'reload': {
        if (this.mine.howCut(WINDOWS[op.w]) === 'offline') {
          return { note: 'not done: a page cannot be loaded offline' };
        }
        await this.views[op.w].reload();
        return {};
      }
      case 'visit':
        return { note: await this.visit(op.w) };
      case 'page': {
        const view = this.views[op.w];
        for (let turn = 0; turn < op.wheels; turn += 1) {
          await view.wheel(-600);
          await pause(250);
        }
        if (!this.mine.howCut(WINDOWS[op.w])) {
          await this.unbroken(op.w, 'gap in the window after scrolling back');
        }
        return {};
      }
      case 'jump': {
        const person = WINDOWS[op.w];
        if (this.mine.howCut(person) === 'offline') {
          return { note: 'not done: a page cannot be loaded offline' };
        }
        const old = this.ideal.roots(person).slice(0, -30);
        const key = old[op.pick % Math.max(1, old.length)];
        if (!key || !this.mine.message(person, key)) {
          return { note: 'no message that old' };
        }
        const view = this.views[op.w];
        const id = await this.idOf(key);
        await view.open({ messageId: id });
        try {
          await expect(view.messageById(id)).toBeVisible({ timeout: 15_000 });
        } catch {
          this.found('linked message not shown', `${op.w}: ${key}`);
        }
        if (!this.mine.howCut(person)) {
          await this.unbroken(op.w, 'gap in the window after opening a link');
        }
        return { note: `to ${key}` };
      }
      case 'bottom':
        await this.toBottom(this.views[op.w]);
        return {};
      case 'look': {
        const cut = this.mine.howCut(WINDOWS[op.w]);
        const { wrong } = await this.readUntilRight(op.w, 15);
        if (wrong) {
          this.found(
            cut ? 'window of a cut-off device differs' : 'window differs',
            `${op.w}${cut ? ` (${cut})` : ''}: ${wrong}`
          );
        }
        return {};
      }
      case 'settle': {
        for (const win of WINS) {
          const cut = this.mine.howCut(WINDOWS[win]);
          const { wrong } = await this.readUntilRight(win, 20);
          if (wrong) {
            this.found(
              cut ? 'window of a cut-off device differs' : 'window differs',
              `${win}${cut ? ` (${cut})` : ''}: ${wrong}`
            );
          }
        }
        return {};
      }
      default:
        return { acts: await this.writes([op]) };
    }
  }

  async all(): Promise<Result> {
    const started = Date.now();
    await this.setUp();
    const ops: Op[] = [...this.kase.ops];
    for (this.step = 0; this.step < ops.length; this.step += 1) {
      const op = ops[this.step];
      const began = Date.now();
      let done: { acts?: ActRecord[]; note?: string } = {};
      try {
        done = await this.one(op);
      } catch (error) {
        const said = String(error).split('\n').slice(0, 3).join(' ');
        this.found('operation failed', `${describe(op)}: ${said}`);
        if ('w' in op) {
          await this.picture(op.w);
          await this.backOnChannel(op.w);
        }
        done = { note: `failed: ${said}` };
      }
      this.steps.push({
        i: this.step,
        text: describe(op),
        acts: done.acts ?? [],
        note: done.note,
        ms: Date.now() - began,
      });
    }

    // The end: everyone connected, everything delivered, every window read,
    // then every window loaded again and read once more.
    this.step = -1;
    const cutOff = [...this.restorers.keys()];
    for (const person of cutOff) await this.restore(person);
    if (cutOff.length > 0) {
      await this.delivered(
        RECONNECT_SECONDS,
        'not delivered after reconnecting'
      );
    }
    const windows: Result['end']['windows'] = {};
    for (const win of WINS) {
      const { lines, wrong } = await this.readUntilRight(win, 45);
      windows[win] = { settled: lines, reloaded: [] };
      if (wrong) this.found('window differs at the end', `${win}: ${wrong}`);
    }
    for (const win of WINS) {
      try {
        await this.views[win].open();
      } catch (error) {
        this.found('could not load at the end', `${win}: ${String(error)}`);
      }
      const { lines, wrong } = await this.readUntilRight(win, 30);
      windows[win].reloaded = lines;
      if (wrong)
        this.found('window differs after loading again', `${win}: ${wrong}`);
    }
    const server = await this.serverLines();
    const model = this.mine.lines();
    if (!sameBlocks(server, model)) {
      this.found(
        'services differ from the model at the end',
        difference(server, model, 'services', 'model')
      );
    }
    return {
      id: this.kase.id,
      seed: this.kase.seed,
      profile: this.kase.profile,
      side: this.side,
      bundle: this.bundle,
      ops: this.kase.ops,
      operations: this.kase.ops.reduce(
        (count, op) => count + (op.k === 'par' ? op.ops.length : 1),
        0
      ),
      steps: this.steps,
      findings: this.findings,
      end: {
        server,
        model,
        modelOn: this.ideal.lines(),
        groups: this.mine.groups(),
        authors: this.mine.authors(),
        windows,
      },
      ms: Date.now() - started,
    };
  }

  async close(): Promise<void> {
    for (const restorer of this.restorers.values()) {
      await restorer().catch(() => undefined);
    }
    for (const context of Object.values(this.contexts)) {
      await context.close().catch(() => undefined);
    }
    await this.http?.dispose().catch(() => undefined);
  }

  /** What was learned before a failure that ended the sequence early. */
  partial(): { steps: StepRecord[]; findings: Finding[] } {
    return { steps: this.steps, findings: this.findings };
  }
}
