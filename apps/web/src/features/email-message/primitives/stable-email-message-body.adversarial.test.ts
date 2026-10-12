/**
 * Adversarial tests for the branch's stable email body primitive.
 *
 * The differential suite drives origin/main's createEmailMessageBody (copied
 * verbatim below) and the branch's createStableEmailMessageBody with the same
 * random sequence of prop changes, with the render cache flag OFF (no
 * `context.preparation`), and asserts the user-visible result matches.
 */

import { directExecutor } from '@app/lib/email-render-cache/executor';
import { EmailRenderCache } from '@app/lib/email-render-cache/service';
import { deepEqual } from '@core/util/compareUtils';
import {
  type PreparedEmailBody,
  prepareEmailBody,
} from '@macro-inc/email-renderer';
import {
  mountEmailBody,
  type ResourceLifetime,
  type ThemeColorParams,
} from '@macro-inc/email-renderer/browser';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailPreparation,
  PreparedEmailLease,
} from '../context/email-preparation';
import type { EmailRenderingContextValue } from '../context/email-rendering-context';
import type { EmailAttachment, EmailMessage } from '../core/email-message';
import { message } from '../tests/messages';
import type { EmailMessageBodyProps } from './email-message-body';
import { createStableEmailMessageBody } from './stable-email-message-body';

// ---------------------------------------------------------------------------
// origin/main:apps/web/src/features/email-message/primitives/email-message-body.ts
// ---------------------------------------------------------------------------
function createMainEmailMessageBody(
  props: EmailMessageBodyProps,
  renderingContext: EmailRenderingContextValue
) {
  const [showFullHTML, setShowFullHTML] = createSignal(false);
  const content = createMemo(
    () => ({
      id: props.message.db_id,
      html: props.message.body_html_sanitized,
      replylessHtml: props.message.body_replyless,
      text: props.message.body_text,
      macro: props.message.body_macro,
      attachments: props.message.attachments,
      isPersonal: props.isPersonal,
      showFullContent: props.showFullContent,
      normalizeFonts:
        props.isPersonal &&
        !props.message.from?.email?.toLowerCase().endsWith('@macro.com'),
    }),
    undefined,
    { equals: deepEqual }
  );
  const prepared = createMemo(() =>
    prepareEmailBody(content(), {
      showQuotedContent: showFullHTML(),
      showFullContent: content().showFullContent,
      images: renderingContext.images,
    })
  );
  const rendered = createMemo(() => {
    if ((!showFullHTML() && content().macro) || !content().html) return;
    const body = prepared();
    const attachments = content().attachments;
    const host = document.createElement('div');
    host.style.minWidth = '0';
    host.style.width = '100%';
    const renderer = mountEmailBody(host, body, {
      theme: renderingContext.theme(),
      adaptColors: content().isPersonal || !body.hasTable,
      normalizeFonts: content().normalizeFonts,
      expanded: untrack(props.isBodyExpanded),
      prepareLinks: renderingContext.prepareLinks,
      resolveImages: (root, lifetime) =>
        renderingContext.resolveImages(root, attachments, lifetime),
    });
    onCleanup(() => renderer.dispose());
    return { host, renderer };
  });
  createEffect(() => rendered()?.renderer.setExpanded(props.isBodyExpanded()));
  return {
    showFullHTML,
    setShowFullHTML,
    host: () => rendered()?.host,
    hasHiddenReplyStructure: () => prepared().hasHiddenContent,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const baseTheme: ThemeColorParams = {
  inkL: 0.2,
  inkC: 0,
  inkH: 0,
  panelL: 1,
  accentL: 0.6,
  accentC: 0.1,
  accentH: 50,
};
const darkTheme: ThemeColorParams = {
  ...baseTheme,
  inkL: 0.9,
  panelL: 0.15,
};

type BodyApi = Pick<
  ReturnType<typeof createStableEmailMessageBody>,
  'showFullHTML' | 'setShowFullHTML' | 'host' | 'hasHiddenReplyStructure'
>;
type Factory = (
  props: EmailMessageBodyProps,
  context: EmailRenderingContextValue
) => BodyApi;

interface Inputs {
  message: Accessor<EmailMessage>;
  isPersonal: Accessor<boolean>;
  showFullContent: Accessor<boolean | undefined>;
  expanded: Accessor<boolean>;
  theme: Accessor<ThemeColorParams>;
}

function mount(factory: Factory, inputs: Inputs) {
  const live = new Set<object>();
  const container = document.createElement('div');
  document.body.append(container);
  let resolveCalls = 0;
  const context: EmailRenderingContextValue = {
    theme: inputs.theme,
    images: { remote: 'allow' },
    async resolveImages(
      root: ShadowRoot,
      attachments: EmailAttachment[],
      lifetime: ResourceLifetime
    ) {
      resolveCalls++;
      const token = {};
      live.add(token);
      lifetime.onDispose(() => live.delete(token));
      for (const img of root.querySelectorAll('img[src^="cid:"]')) {
        const cid = img.getAttribute('src')!.slice(4);
        const match = attachments.find(
          (attachment) =>
            attachment.content_id?.replace(/[<>]/g, '') === cid &&
            attachment.sfs_id
        );
        if (match)
          img.setAttribute('src', `https://files.invalid/${match.sfs_id}`);
      }
    },
  };
  return createRoot((dispose) => {
    const api = factory(
      {
        get message() {
          return inputs.message();
        },
        get isPersonal() {
          return inputs.isPersonal();
        },
        get showFullContent() {
          return inputs.showFullContent();
        },
        isBodyExpanded: inputs.expanded,
        setExpandedMessageBody() {},
        setFocusedMessageId() {},
        isFocused: false,
      },
      context
    );
    return {
      api,
      container,
      live,
      resolveCalls: () => resolveCalls,
      dispose() {
        dispose();
        container.remove();
      },
    };
  });
}
type Mounted = ReturnType<typeof mount>;

/** Inline declaration order is not user-visible; compare declarations as sets. */
function normalize(html: string | undefined): string | undefined {
  if (html === undefined) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('[style]')) {
    const declarations = (element.getAttribute('style') ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .sort();
    element.setAttribute('style', declarations.join('; '));
  }
  return template.innerHTML;
}

/** What EmailMessageBody (views/email-message-body.tsx) would display. */
function visible(mounted: Mounted, msg: EmailMessage) {
  const full = mounted.api.showFullHTML();
  const dots = !full && mounted.api.hasHiddenReplyStructure();
  if (!full && msg.body_macro)
    return { branch: 'macro', content: msg.body_macro, dots };
  if (!msg.body_html_sanitized)
    return { branch: 'text', content: msg.body_text ?? '', dots };
  const host = mounted.api.host();
  return {
    branch: 'html',
    content: host
      ? normalize(host.shadowRoot?.innerHTML)
      : '<<loading fallback>>',
    dots,
  };
}

/** Mirror the view inserting the current host into the document. */
function insert(mounted: Mounted) {
  const host = mounted.api.host();
  if (!host) mounted.container.replaceChildren();
  else if (host.parentElement !== mounted.container)
    mounted.container.replaceChildren(host);
}

async function settle(...all: Mounted[]) {
  for (const mounted of all) insert(mounted);
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HTML = [
  '<p>Hello</p>',
  '<p>Hello</p><div class="macro_quote"><p>Quoted thread</p></div>',
  '<p>Reply</p><div class="gmail_quote"><blockquote>Older message</blockquote></div>',
  '<table><tr><td style="color:#333333">Designed newsletter</td></tr></table>',
  '<p>Logo <img src="cid:logo"></p>',
  '<p>Hi there</p><div class="gmail_signature">-- Signature</div>',
  '<p style="color:#ffffff;background-color:#000000">Inverted</p>',
  null,
  '',
];
const REPLYLESS = [null, '<p>Hello</p>', '<p>Reply</p>', ''];
const TEXT = [null, 'plain text body', '**markdown text**'];
const MACRO = [null, null, 'Macro *markdown* body'];
const ATTACHMENTS: EmailAttachment[][] = [
  [],
  [{ db_id: 'a', content_id: '<logo>', sfs_id: 'file-1' }],
  [{ db_id: 'a', content_id: '<logo>', sfs_id: 'file-2' }],
  [
    { db_id: 'a', content_id: '<logo>', sfs_id: 'file-1' },
    { db_id: 'b', filename: 'report.pdf', sfs_id: 'pdf' },
  ],
];
const FROM = ['sender@example.com', 'person@macro.com'];

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

describe('flag OFF differential: branch body vs origin/main body', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the same content, quote affordance, and resource count across random prop sequences', async () => {
    const failures: string[] = [];
    for (
      let seed = 1;
      seed <= Number(process.env.ADV_SEEDS ?? 150) && failures.length === 0;
      seed++
    ) {
      const random = rng(seed);
      const [msg, setMsg] = createSignal<EmailMessage>(
        message('one', {
          body_html_sanitized: pick(random, HTML),
          body_replyless: pick(random, REPLYLESS),
          body_text: pick(random, TEXT),
          body_macro: pick(random, MACRO),
          attachments: pick(random, ATTACHMENTS),
        })
      );
      const [isPersonal, setIsPersonal] = createSignal(random() < 0.5);
      const [showFullContent, setShowFullContent] = createSignal<
        boolean | undefined
      >(pick(random, [undefined, true, false]));
      const [expanded, setExpanded] = createSignal(random() < 0.5);
      const [theme, setTheme] = createSignal(baseTheme);
      const inputs = {
        message: msg,
        isPersonal,
        showFullContent,
        expanded,
        theme,
      };
      const main = mount(createMainEmailMessageBody, inputs);
      const branch = mount(createStableEmailMessageBody, inputs);
      const log: string[] = [];
      try {
        await settle(main, branch);
        for (let step = 0; step < 20; step++) {
          const action = Math.floor(random() * 12);
          const current = msg();
          switch (action) {
            case 0:
              log.push('equal DTO clone');
              setMsg({ ...structuredClone(current), updated_at: `${step}` });
              break;
            case 1: {
              const html = pick(random, HTML);
              log.push(`html=${JSON.stringify(html)}`);
              setMsg({ ...current, body_html_sanitized: html });
              break;
            }
            case 2: {
              const replyless = pick(random, REPLYLESS);
              log.push(`replyless=${JSON.stringify(replyless)}`);
              setMsg({ ...current, body_replyless: replyless });
              break;
            }
            case 3: {
              const text = pick(random, TEXT);
              log.push(`text=${JSON.stringify(text)}`);
              setMsg({ ...current, body_text: text });
              break;
            }
            case 4: {
              const macro = pick(random, MACRO);
              log.push(`macro=${JSON.stringify(macro)}`);
              setMsg({ ...current, body_macro: macro });
              break;
            }
            case 5: {
              const attachments = pick(random, ATTACHMENTS);
              log.push(`attachments=${JSON.stringify(attachments)}`);
              setMsg({ ...current, attachments: structuredClone(attachments) });
              break;
            }
            case 6:
              log.push(`isPersonal=${!isPersonal()}`);
              setIsPersonal(!isPersonal());
              break;
            case 7: {
              const value = pick(random, [undefined, true, false]);
              log.push(`showFullContent=${value}`);
              setShowFullContent(value);
              break;
            }
            case 8:
              log.push(`expanded=${!expanded()}`);
              setExpanded(!expanded());
              break;
            case 9: {
              const next = pick(random, [
                baseTheme,
                { ...baseTheme },
                darkTheme,
              ]);
              log.push(`theme.inkL=${next.inkL}`);
              setTheme(next);
              break;
            }
            case 10: {
              const from = pick(random, FROM);
              log.push(`from=${from}`);
              setMsg({ ...current, from: { email: from } });
              break;
            }
            default:
              // The view only offers "..." while it is visible.
              if (visible(main, msg()).dots) {
                log.push('click ...');
                main.api.setShowFullHTML(true);
                branch.api.setShowFullHTML(true);
              } else log.push('noop');
          }
          await settle(main, branch);
          const expected = visible(main, msg());
          const actual = visible(branch, msg());
          const expectedLive = expected.branch === 'html' ? main.live.size : 0;
          const actualLive = actual.branch === 'html' ? branch.live.size : 0;
          if (!deepEqual(expected, actual) || expectedLive !== actualLive) {
            failures.push(
              [
                `seed ${seed}, step ${step}`,
                `steps: ${log.join(' | ')}`,
                `main:   ${JSON.stringify({ ...expected, live: expectedLive })}`,
                `branch: ${JSON.stringify({ ...actual, live: actualLive })}`,
              ].join('\n')
            );
            break;
          }
          // Hidden HTML resources must never outlive the HTML route.
          if (actual.branch !== 'html' && branch.live.size > 0) {
            failures.push(
              `seed ${seed}, step ${step}: ${branch.live.size} image lifetimes live behind ${actual.branch}\nsteps: ${log.join(' | ')}`
            );
            break;
          }
        }
      } finally {
        main.dispose();
        branch.dispose();
      }
      if (branch.live.size)
        failures.push(`seed ${seed}: leaked ${branch.live.size} lifetimes`);
    }
    expect(failures).toEqual([]);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// Flag ON: lease failures that are not caused by this body's own cleanup.
// ---------------------------------------------------------------------------
describe('flag ON: externally cancelled leases', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const abort = () =>
    new DOMException('Email preparation cancelled', 'AbortError');

  function controllable() {
    const jobs: {
      request: Parameters<EmailPreparation['acquire']>[0];
      resolve(body: PreparedEmailBody): void;
      reject(error: unknown): void;
      release: ReturnType<typeof vi.fn>;
    }[] = [];
    const preparation: EmailPreparation = {
      acquire(request) {
        const { promise, resolve, reject } =
          Promise.withResolvers<PreparedEmailBody>();
        const release = vi.fn();
        jobs.push({ request, resolve, reject, release });
        return {
          ready: undefined,
          promise,
          promote() {},
          release,
        } satisfies PreparedEmailLease;
      },
    };
    return { jobs, preparation };
  }

  function body(
    msg: EmailMessage,
    preparation: EmailPreparation
  ): ReturnType<typeof createStableEmailMessageBody> & { dispose(): void } {
    return createRoot((dispose) => ({
      ...createStableEmailMessageBody(
        {
          message: msg,
          isPersonal: true,
          isBodyExpanded: () => true,
          setExpandedMessageBody() {},
          setFocusedMessageId() {},
          isFocused: false,
        },
        { theme: () => baseTheme, resolveImages: async () => {}, preparation }
      ),
      dispose,
    }));
  }

  it('an AbortError on a live lease acquires again, then prepares directly', async () => {
    const { jobs, preparation } = controllable();
    const app = body(
      message('one', { body_html_sanitized: '<p>Body</p>' }),
      preparation
    );
    try {
      expect(app.isPending()).toBe(true);
      // e.g. EmailRenderCache rejects with AbortError when another consumer
      // re-binds the same message to a different source (binding.current=false)
      jobs[0].reject(abort());
      await vi.waitFor(() => expect(jobs).toHaveLength(2));
      expect(app.isPending()).toBe(true);
      expect(jobs[0].release).toHaveBeenCalled();
      // Repeated cancellation falls back to preparing directly, as without
      // the cache: never a silent stall, never an error for a renderable body.
      for (let index = 1; index <= 3; index++) {
        jobs[index].reject(abort());
        await vi.waitFor(() =>
          expect(jobs.length > index + 1 || !!app.host()).toBe(true)
        );
      }
      await vi.waitFor(() => expect(app.host()).toBeDefined());
      expect(app.host()?.shadowRoot?.textContent).toContain('Body');
      expect(app.isError()).toBe(false);
      expect(app.isPending()).toBe(false);
      expect(jobs).toHaveLength(4);
    } finally {
      app.dispose();
    }
  });

  it('an aborted quote variant is requested again, and "..." can ask again', async () => {
    const { jobs, preparation } = controllable();
    const input = {
      html: '<p>Hello</p><div class="macro_quote"><p>Quoted</p></div>',
    };
    const app = body(
      message('one', { body_html_sanitized: input.html }),
      preparation
    );
    try {
      jobs[0].resolve(prepareEmailBody(input));
      await vi.waitFor(() => expect(app.host()).toBeDefined());
      expect(app.hasHiddenReplyStructure()).toBe(true);
      app.setShowFullHTML(true);
      expect(jobs).toHaveLength(2);
      jobs[1].reject(abort());
      await vi.waitFor(() => expect(jobs).toHaveLength(3));
      expect(jobs[2].request.options.showQuotedContent).toBe(true);
      jobs[2].resolve(prepareEmailBody(input, { showQuotedContent: true }));
      await vi.waitFor(() => expect(app.showFullHTML()).toBe(true));
      // A cache failure falls back to preparing the variant directly.
      app.setShowFullHTML(false);
      expect(jobs).toHaveLength(4);
      jobs[3].reject(new Error('worker failed'));
      await vi.waitFor(() => expect(app.showFullHTML()).toBe(false));
      expect(app.isError()).toBe(false);
      expect(app.isPending()).toBe(false);
    } finally {
      app.dispose();
    }
  });

  it('an aborted refresh after the source changed requests the new source again', async () => {
    const { jobs, preparation } = controllable();
    const [msg, setMsg] = createSignal(
      message('one', { body_html_sanitized: '<p>Version 1</p>' })
    );
    const app = createRoot((dispose) => ({
      ...createStableEmailMessageBody(
        {
          get message() {
            return msg();
          },
          isPersonal: true,
          isBodyExpanded: () => true,
          setExpandedMessageBody() {},
          setFocusedMessageId() {},
          isFocused: false,
        },
        { theme: () => baseTheme, resolveImages: async () => {}, preparation }
      ),
      dispose,
    }));
    try {
      jobs[0].resolve(prepareEmailBody({ html: '<p>Version 1</p>' }));
      await vi.waitFor(() => expect(app.host()).toBeDefined());
      setMsg({ ...msg(), body_html_sanitized: '<p>Version 2</p>' });
      expect(jobs).toHaveLength(2);
      jobs[1].reject(abort());
      // Version 2 is requested again rather than settling on Version 1.
      await vi.waitFor(() => expect(jobs).toHaveLength(3));
      expect(jobs[2].request.input.html).toBe('<p>Version 2</p>');
      jobs[2].resolve(prepareEmailBody({ html: '<p>Version 2</p>' }));
      await vi.waitFor(() =>
        expect(app.host()?.shadowRoot?.textContent).toContain('Version 2')
      );
    } finally {
      app.dispose();
    }
  });

  it('a competing acquire of the same message with a different source (e.g. a neighbor prewarm from a stale local copy) must not strand the visible body', async () => {
    const cache = new EmailRenderCache({ executor: directExecutor });
    const fresh = message('one', {
      body_html_sanitized: '<p>Fresh body</p>',
      body_replyless: '<p>Fresh body</p>',
    });
    const app = body(fresh, cache);
    // prepareThreads() acquires the same (mailbox, message) from
    // readCachedEmailThread(); a different snapshot rebinds the source.
    const prewarm = cache.acquire({
      messageId: fresh.db_id,
      threadId: fresh.thread_db_id,
      mailboxId: fresh.link_id,
      input: { html: '<p>Stale body</p>', replylessHtml: null, text: null },
      options: { showFullContent: false },
      priority: 1,
    });
    void prewarm.promise.catch(() => {});
    try {
      await vi.waitFor(
        () => {
          expect(app.isPending()).toBe(false);
        },
        { timeout: 1000 }
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        app.host()?.shadowRoot?.textContent ??
          (app.isError() ? '<<retry button>>' : '<<Loading message… forever>>')
      ).toContain('Fresh body');
    } finally {
      prewarm.release();
      app.dispose();
      cache.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Flag ON model test: random lease timing, DTO changes, "..." clicks, session
// swaps, canRender flips and disposal. Invariants: every lease is released,
// at most displayed+pending leases are held, and once all work settles the
// visible body is exactly the current request's prepared body.
// ---------------------------------------------------------------------------
describe('flag ON model: lease lifetimes and final body', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('never leaks leases and always converges on the current request', async () => {
    const failures: string[] = [];
    let quotedAtEnd = 0;
    let rejected = 0;
    for (
      let seed = 1;
      seed <= Number(process.env.ADV_MODEL_SEEDS ?? 300) &&
      failures.length === 0;
      seed++
    ) {
      const random = rng(seed);
      interface Job {
        id: number;
        service: string;
        request: Parameters<EmailPreparation['acquire']>[0];
        body: PreparedEmailBody;
        settled: boolean;
        releases: number;
        resolve(): void;
        reject(): void;
      }
      const jobs: Job[] = [];
      const makeService = (name: string): EmailPreparation => ({
        acquire(request) {
          const body = prepareEmailBody(request.input, request.options);
          const { promise, resolve, reject } =
            Promise.withResolvers<PreparedEmailBody>();
          const job: Job = {
            id: jobs.length,
            service: name,
            request: structuredClone(request),
            body,
            settled: false,
            releases: 0,
            resolve: () => {
              job.settled = true;
              resolve(body);
            },
            reject: () => {
              job.settled = true;
              reject(new Error('worker failed'));
            },
          };
          jobs.push(job);
          const ready = random() < 0.3 ? body : undefined;
          if (ready) job.settled = true;
          void promise.catch(() => {});
          if (ready) resolve(body);
          return {
            ready,
            promise,
            promote() {},
            release() {
              job.releases++;
            },
          };
        },
      });
      const services = [makeService('A'), makeService('B'), undefined];
      const [service, setService] = createSignal<EmailPreparation | undefined>(
        services[0]
      );
      const [canRender, setCanRender] = createSignal(true);
      const HTMLS = [
        '<p>Hello</p><div class="macro_quote"><p>Quoted</p></div>',
        '<p>Edited</p><div class="macro_quote"><p>Quoted again</p></div>',
        '<p>Plain</p>',
      ];
      const [msg, setMsg] = createSignal(
        message('one', { body_html_sanitized: HTMLS[0] })
      );
      const app = createRoot((dispose) => ({
        dispose,
        body: createStableEmailMessageBody(
          {
            get message() {
              return msg();
            },
            isPersonal: true,
            isBodyExpanded: () => true,
            setExpandedMessageBody() {},
            setFocusedMessageId() {},
            isFocused: false,
          },
          {
            canRender,
            theme: () => baseTheme,
            resolveImages: async () => {},
            get preparation() {
              return service();
            },
          }
        ),
      }));
      const log: string[] = [];
      const held = () =>
        jobs.filter((job) => job.releases === 0 && job.service !== '-').length;
      try {
        for (let step = 0; step < 25; step++) {
          const action = Math.floor(random() * 9);
          const pending = jobs.filter((job) => !job.settled);
          if (action <= 2 && pending.length) {
            const job = pick(random, pending);
            if (random() < 0.85) {
              log.push(`resolve#${job.id}`);
              job.resolve();
            } else {
              log.push(`reject#${job.id}`);
              rejected++;
              job.reject();
            }
          } else if (action === 3) {
            const html = pick(random, HTMLS);
            log.push(`html=${HTMLS.indexOf(html)}`);
            setMsg({ ...msg(), body_html_sanitized: html });
          } else if (action === 4) {
            log.push('equal DTO');
            setMsg({ ...structuredClone(msg()) });
          } else if (action === 5) {
            if (
              !app.body.showFullHTML() &&
              app.body.hasHiddenReplyStructure()
            ) {
              log.push(
                app.body.isPending() ? 'click ... (disabled)' : 'click ...'
              );
              if (!app.body.isPending()) app.body.setShowFullHTML(true);
            }
          } else if (action === 6) {
            const next = pick(random, [0, 1, 2]);
            log.push(`service=${'AB-'[next]}`);
            setService(services[next]);
          } else if (action === 7) {
            log.push(`canRender=${!canRender()}`);
            setCanRender(!canRender());
          } else if (app.body.isError() && !app.body.host()) {
            log.push('retry');
            app.body.retry();
          }
          for (let i = 0; i < 3; i++) await Promise.resolve();
          // A settled, error-free body must be the current request's body.
          const host = app.body.host();
          if (host && !app.body.isPending() && !app.body.isError()) {
            const div = document.createElement('div');
            div.innerHTML = prepareEmailBody(
              { html: msg().body_html_sanitized ?? null },
              { showQuotedContent: app.body.showFullHTML() }
            ).html;
            const shown = host.shadowRoot?.querySelector('div')?.innerHTML;
            if (shown !== div.innerHTML) {
              failures.push(
                `seed ${seed} step ${step}: settled body is stale/wrong: ${shown} vs ${div.innerHTML}\n${log.join(' | ')}`
              );
              break;
            }
          }
          // Only the displayed lease and one pending replacement may be held.
          const unreleased = jobs.filter((job) => job.releases === 0);
          const unsettledHeld = unreleased.filter((job) => !job.settled);
          if (unreleased.length > 2 || unsettledHeld.length > 1) {
            failures.push(
              `seed ${seed} step ${step}: ${unreleased.length} unreleased leases (${unreleased.map((j) => `#${j.id}${j.settled ? '' : '?'}`)})\n${log.join(' | ')}`
            );
            break;
          }
        }
        if (failures.length) break;
        if (seed % 3 === 0) {
          // Dispose mid-preparation, then let stragglers complete.
          app.dispose();
          for (const job of jobs) if (!job.settled) job.resolve();
          for (let i = 0; i < 4; i++) await Promise.resolve();
          const leaked = jobs.filter((job) => job.releases === 0);
          if (leaked.length)
            failures.push(
              `seed ${seed}: disposal mid-preparation leaked ${leaked.map((j) => `#${j.id}`)}\n${log.join(' | ')}`
            );
          continue;
        }
        // Settle: canRender on, resolve everything, retry errors.
        setCanRender(true);
        for (let round = 0; round < 5; round++) {
          for (const job of jobs) if (!job.settled) job.resolve();
          for (let i = 0; i < 4; i++) await Promise.resolve();
          if (app.body.isError()) app.body.retry();
          for (let i = 0; i < 4; i++) await Promise.resolve();
        }
        const expected = prepareEmailBody(
          {
            html: msg().body_html_sanitized ?? null,
            replylessHtml: null,
            text: null,
          },
          { showQuotedContent: app.body.showFullHTML() }
        );
        if (app.body.showFullHTML()) quotedAtEnd++;
        const shown = app.body
          .host()
          ?.shadowRoot?.querySelector('div')?.innerHTML;
        const expectedHtml = (() => {
          const div = document.createElement('div');
          div.innerHTML = expected.html;
          return div.innerHTML;
        })();
        if (
          shown !== expectedHtml ||
          app.body.isPending() ||
          app.body.isError()
        ) {
          failures.push(
            `seed ${seed}: after settling, shown=${JSON.stringify(shown)} expected=${JSON.stringify(expectedHtml)} pending=${app.body.isPending()} error=${app.body.isError()}\n${log.join(' | ')}`
          );
        }
      } finally {
        app.dispose();
      }
      for (let i = 0; i < 4; i++) await Promise.resolve();
      const leaked = jobs.filter((job) => job.releases === 0);
      if (leaked.length && !failures.length)
        failures.push(
          `seed ${seed}: leases never released: ${leaked.map((j) => `#${j.id}`)}\n${log.join(' | ')}`
        );
      void held;
    }
    expect(failures).toEqual([]);
    expect(quotedAtEnd).toBeGreaterThan(10);
    expect(rejected).toBeGreaterThan(10);
  }, 600_000);
});
