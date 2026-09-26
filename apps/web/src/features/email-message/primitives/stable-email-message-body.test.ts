import { directExecutor } from '@app/lib/email-render-cache/executor';
import { EmailRenderCache } from '@app/lib/email-render-cache/service';
import * as emailRenderer from '@macro-inc/email-renderer';
import {
  type PreparedEmailBody,
  prepareEmailBody,
} from '@macro-inc/email-renderer';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailPreparation,
  PreparedEmailLease,
} from '../context/email-preparation';
import { message } from '../tests/messages';
import { createStableEmailMessageBody } from './stable-email-message-body';

const theme = {
  inkL: 0.2,
  inkC: 0,
  inkH: 0,
  panelL: 1,
  accentL: 0.6,
  accentC: 0.1,
  accentH: 50,
};

describe('stable email host', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('releases the displayed host and resources when its owning session ends', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const released = vi.fn();
    const app = createRoot((dispose) => {
      const [canRender, setCanRender] = createSignal(true);
      const body = createStableEmailMessageBody(
        {
          message: message('session', {
            body_html_sanitized: '<p>Private body</p>',
          }),
          isPersonal: true,
          isBodyExpanded: () => true,
          setExpandedMessageBody() {},
          setFocusedMessageId() {},
          isFocused: false,
        },
        {
          canRender,
          theme: () => theme,
          resolveImages: async (_root, _attachments, lifetime) => {
            lifetime.onDispose(released);
          },
        }
      );
      return { dispose, body, setCanRender };
    });
    try {
      expect(app.body.host()?.shadowRoot?.textContent).toContain(
        'Private body'
      );
      await Promise.resolve();
      app.setCanRender(false);
      expect(app.body.host()).toBeUndefined();
      expect(app.body.isPending()).toBe(false);
      expect(released).toHaveBeenCalledTimes(1);
    } finally {
      app.dispose();
    }
  });

  it('keeps Macro Markdown visible until the requested HTML quote variant is ready', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const input = { html: '<p>Hello</p><div class="macro_quote">Quoted</div>' };
    const ready = prepareEmailBody(input);
    const quote = Promise.withResolvers<PreparedEmailBody>();
    const resolveImages = vi.fn(async () => {});
    const app = createRoot((dispose) => ({
      dispose,
      body: createStableEmailMessageBody(
        {
          message: message('macro', {
            body_macro: 'Existing mention formatting',
            body_html_sanitized: input.html,
          }),
          isPersonal: true,
          isBodyExpanded: () => true,
          setExpandedMessageBody() {},
          setFocusedMessageId() {},
          isFocused: false,
        },
        {
          theme: () => theme,
          resolveImages,
          preparation: {
            acquire: (request) => ({
              ready: request.options.showQuotedContent ? undefined : ready,
              promise: request.options.showQuotedContent
                ? quote.promise
                : Promise.resolve(ready),
              promote() {},
              release() {},
            }),
          },
        }
      ),
    }));
    try {
      app.body.setShowFullHTML(true);
      expect(app.body.showFullHTML()).toBe(false);
      expect(app.body.host()).toBeUndefined();
      expect(resolveImages).not.toHaveBeenCalled();
      quote.resolve(prepareEmailBody(input, { showQuotedContent: true }));
      await Promise.resolve();
      expect(app.body.showFullHTML()).toBe(true);
      expect(app.body.host()?.shadowRoot?.textContent).toContain('Quoted');
    } finally {
      app.dispose();
    }
  });

  it('shares preparation but keeps identical CIDs bound to each message and refreshes changed attachments', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const prepare = vi.fn(directExecutor.prepare);
    const preparation = new EmailRenderCache({
      executor: { ...directExecutor, prepare },
    });
    const app = createRoot((dispose) => {
      const [file, setFile] = createSignal('first');
      const bodies = ['one', 'two'].map((id) =>
        createStableEmailMessageBody(
          {
            get message() {
              return message(id, {
                body_html_sanitized: '<img src="cid:logo">',
                attachments: [
                  {
                    db_id: id,
                    content_id: '<logo>',
                    sfs_id: id === 'one' ? file() : 'second',
                  },
                ],
              });
            },
            isPersonal: true,
            isBodyExpanded: () => true,
            setExpandedMessageBody() {},
            setFocusedMessageId() {},
            isFocused: false,
          },
          {
            theme: () => theme,
            preparation,
            resolveImages: async (root, attachments) => {
              root.querySelector('img')!.src =
                `https://files.invalid/${attachments[0].sfs_id}`;
            },
          }
        )
      );
      return { dispose, bodies, setFile };
    });
    try {
      await vi.waitFor(() =>
        expect(
          app.bodies[1].host()?.shadowRoot?.querySelector('img')?.src
        ).toBe('https://files.invalid/second')
      );
      const firstHost = app.bodies[0].host()!;
      expect(firstHost.shadowRoot?.querySelector('img')?.src).toBe(
        'https://files.invalid/first'
      );
      expect(prepare).toHaveBeenCalledTimes(1);
      app.setFile('replacement');
      await vi.waitFor(() =>
        expect(firstHost.shadowRoot?.querySelector('img')?.src).toBe(
          'https://files.invalid/replacement'
        )
      );
      expect(app.bodies[0].host()).toBe(firstHost);
      expect(app.bodies[1].host()?.shadowRoot?.querySelector('img')?.src).toBe(
        'https://files.invalid/second'
      );
      expect(prepare).toHaveBeenCalledTimes(1);
    } finally {
      app.dispose();
      preparation.dispose();
    }
  });

  it('keeps a pending quote variant local and never publishes an old message completion', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const jobs: {
      resolve(body: PreparedEmailBody): void;
      release: ReturnType<typeof vi.fn>;
      lease: PreparedEmailLease;
    }[] = [];
    const preparation: EmailPreparation = {
      acquire: () => {
        let resolve!: (body: PreparedEmailBody) => void;
        const promise = new Promise<PreparedEmailBody>((complete) => {
          resolve = complete;
        });
        const release = vi.fn();
        const lease = { ready: undefined, promise, promote() {}, release };
        jobs.push({ resolve, release, lease });
        return lease;
      },
    };
    const app = createRoot((dispose) => {
      const [value, setValue] = createSignal(
        message('one', { body_html_sanitized: '<p>One</p>' })
      );
      const body = createStableEmailMessageBody(
        {
          get message() {
            return value();
          },
          isPersonal: true,
          isBodyExpanded: () => true,
          setExpandedMessageBody() {},
          setFocusedMessageId() {},
          isFocused: false,
        },
        { theme: () => theme, resolveImages: async () => {}, preparation }
      );
      return { dispose, value, setValue, body };
    });
    try {
      expect(app.body.host()).toBeUndefined();
      jobs[0].resolve(prepareEmailBody({ html: '<p>One</p>' }));
      await Promise.resolve();
      const host = app.body.host();
      app.body.setShowFullHTML(true);
      expect(app.body.host()).toBe(host);
      expect(jobs[0].release).not.toHaveBeenCalled();
      app.setValue({
        ...app.value(),
        db_id: 'two',
        body_html_sanitized: '<p>Two</p>',
      });
      expect(app.body.host()).toBeUndefined();
      jobs[1].resolve(prepareEmailBody({ html: '<p>Stale quote</p>' }));
      jobs.at(-1)!.resolve(prepareEmailBody({ html: '<p>Two</p>' }));
      await Promise.resolve();
      expect(app.body.host()?.shadowRoot?.textContent).toContain('Two');
      expect(app.body.host()?.shadowRoot?.textContent).not.toContain('Stale');
      expect(jobs[0].release).toHaveBeenCalledTimes(1);
    } finally {
      app.dispose();
    }
    expect(jobs.at(-1)!.release).toHaveBeenCalledTimes(1);
  });

  it('keeps the host and child DOM on equal DTOs; changes presentation only when relevant', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const prepare = vi.spyOn(emailRenderer, 'prepareEmailBody');
    const resolveImages = vi.fn(async () => {});
    const app = createRoot((dispose) => {
      const [value, setValue] = createSignal(
        message('one', {
          body_html_sanitized: '<p>Hello</p>',
          body_replyless: '<p>Hello</p>',
        })
      );
      const [colors, setColors] = createSignal(theme);
      const [expanded, setExpanded] = createSignal(true);
      const body = createStableEmailMessageBody(
        {
          get message() {
            return value();
          },
          isPersonal: true,
          isBodyExpanded: expanded,
          setExpandedMessageBody() {},
          setFocusedMessageId() {},
          isFocused: false,
        },
        { theme: colors, resolveImages }
      );
      return { dispose, value, setValue, setColors, setExpanded, body };
    });
    try {
      await Promise.resolve();
      const host = app.body.host()!;
      const paragraph = host.shadowRoot!.querySelector('p');
      expect(prepare).toHaveBeenCalledTimes(1);
      app.setValue({
        ...app.value(),
        attachments: [],
        subject: 'Changed metadata',
      });
      app.setColors({ ...theme });
      await Promise.resolve();
      expect(app.body.host()).toBe(host);
      expect(host.shadowRoot!.querySelector('p')).toBe(paragraph);
      expect(prepare).toHaveBeenCalledTimes(1);
      app.setExpanded(false);
      expect(host.shadowRoot!.querySelector('p')).toBe(paragraph);
      app.setColors({ ...theme, inkL: 0.8 });
      await Promise.resolve();
      expect(app.body.host()).toBe(host);
      expect(host.shadowRoot!.querySelector('p')).not.toBe(paragraph);
      expect(prepare).toHaveBeenCalledTimes(1);
      app.setValue({
        ...app.value(),
        db_id: 'two',
        body_html_sanitized: '<p>New identity</p>',
        body_replyless: null,
      });
      await Promise.resolve();
      expect(app.body.host()).not.toBe(host);
      expect(app.body.host()!.shadowRoot!.textContent).toContain(
        'New identity'
      );
    } finally {
      app.dispose();
    }
  });
});
