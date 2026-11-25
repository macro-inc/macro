/**
 * The browser host: the lab's Chromium, driven from Node, Playwright's own
 * runtime. The runner (Bun) starts one host per challenge and speaks
 * host-protocol.ts with it over stdin and stdout, one JSON object per line.
 * Requests are handled one at a time. Anything that is not a well-formed
 * request, or an `open` of any URL but the registered one, ends the host.
 *
 * Run with Node only: `node src/browser-host.ts`.
 */
import { request as httpRequest } from 'node:http';
import { createInterface } from 'node:readline';
import {
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
  type Request,
  type Route,
} from 'playwright';
import { isolatedBrowser } from './browser-options.ts';
import { emptyObservations, type Observations } from './gate.ts';
import { type Action, type HostReply, HostRequest } from './host-protocol.ts';
import {
  CAPABILITY_HEADER,
  LAB_ORIGIN,
  LAB_SUBMIT_PATH,
  LAB_URL,
  SESSION_HEADER,
  TEXT_INPUT_ID,
  TEXT_SUBMIT_ID,
} from './registry.ts';

/** How long one request to the lab may take. */
const LAB_REQUEST_TIMEOUT_MS = 10_000;
/** How long reading the prompt or taking the screenshot may take. */
const CAPTURE_TIMEOUT_MS = 15_000;
const CLICK_TIMEOUT_MS = 5_000;
const SUBMIT_TIMEOUT_MS = 10_000;
const AFTER_ACTION_QUIET_MS = 500;

const QUIZ_SELECTOR = '#quiz';
const PROMPT_SELECTOR = '#prompt';
const OPTION_SELECTOR = 'button[data-lab-option]';

type Session = { context: BrowserContext; page: Page };

const observed: Observations = emptyObservations();
let session: Session | undefined;

const reply = (message: HostReply) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

/** Ends the host. The runner reads a closed stdout as a failed host. */
const quit = (code: number): never => process.exit(code);

const snapshot = () => ({
  ...observed,
  blockedOrigins: [...observed.blockedOrigins],
});

/**
 * Whether a navigation request is for the run's own main frame. A popup's
 * first request has no frame yet, which Playwright reports by throwing.
 */
const isMainFrame = (request: Request, page: Page): boolean => {
  try {
    return request.frame() === page.mainFrame();
  } catch {
    return false;
  }
};

type LabResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

/**
 * One request straight to the lab origin over `node:http`: a fresh
 * connection, no proxy, no redirect followed, the body as sent.
 */
const labRequest = (
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null
): Promise<LabResponse> =>
  new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      url,
      { method, headers, agent: false },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () => {
          const flat: Record<string, string> = {};
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) {
              flat[name] = Array.isArray(value) ? value.join(', ') : value;
            }
          }
          resolve({
            status: incoming.statusCode ?? 502,
            headers: flat,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    outgoing.on('error', reject);
    outgoing.setTimeout(LAB_REQUEST_TIMEOUT_MS, () =>
      outgoing.destroy(new Error('lab request timed out'))
    );
    outgoing.end(body ?? undefined);
  });

/** Forwards an allowed request; a redirect is recorded and fails it. */
const forward = async (route: Route, headers: Record<string, string>) => {
  const request = route.request();
  let response: LabResponse;
  try {
    response = await labRequest(
      request.url(),
      request.method(),
      headers,
      request.postDataBuffer()
    );
  } catch {
    await route.abort('failed');
    return;
  }
  if (response.status >= 300 && response.status < 400) {
    observed.redirects += 1;
    await route.abort('blockedbyclient');
    return;
  }
  await route.fulfill(response);
};

/**
 * Launches Chromium with the run's fresh profile and one context, puts every
 * request through the allowlist (only the lab origin; the capability on the
 * page request only; one main-frame navigation, to the target), and loads
 * the target.
 */
const open = async (
  request: Extract<HostRequest, { type: 'open' }>
): Promise<HostReply> => {
  try {
    const context = await chromium.launchPersistentContext(request.profile, {
      headless: true,
      executablePath: request.executablePath,
      serviceWorkers: 'block',
      acceptDownloads: false,
      viewport: { width: 900, height: 900 },
      // The host's own environment is already the allowlist.
      env: { ...process.env },
      ...isolatedBrowser(),
    });
    const page = context.pages()[0] ?? (await context.newPage());
    session = { context, page };
  } catch {
    return {
      type: 'opened',
      result: 'launch_failed',
      observations: snapshot(),
    };
  }

  const { context, page } = session;
  let navigationAllowed = true;

  // A popup is recorded and closed at once; its requests hit the allowlist
  // below like any other.
  context.on('page', async (opened) => {
    if (opened === page) return;
    observed.popups += 1;
    await opened.close();
  });
  page.on('frameattached', () => {
    observed.extraFrames += 1;
  });
  // The profile's initial about:blank is not a navigation of the run.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() || frame.url() === 'about:blank') return;
    observed.mainNavigations += 1;
    observed.mainFrameUrl = frame.url();
  });

  // The request allowlist does not see WebSockets: refuse every one.
  await context.routeWebSocket(/.*/, async (socket) => {
    observed.blockedOrigins.push(new URL(socket.url()).origin);
    await socket.close();
  });

  await context.route('**/*', async (route: Route) => {
    const intercepted = route.request();
    const url = new URL(intercepted.url());
    if (url.origin !== LAB_ORIGIN) {
      observed.blockedOrigins.push(url.origin);
      await route.abort('blockedbyclient');
      return;
    }

    const headers = {
      ...intercepted.headers(),
      [SESSION_HEADER]: request.sessionNonce,
    };
    if (!intercepted.isNavigationRequest()) {
      await forward(route, headers);
      return;
    }

    if (
      !navigationAllowed ||
      intercepted.url() !== request.targetUrl ||
      !isMainFrame(intercepted, page)
    ) {
      observed.blockedNavigations += 1;
      await route.abort('blockedbyclient');
      return;
    }

    navigationAllowed = false;
    await forward(route, {
      ...headers,
      [CAPABILITY_HEADER]: request.capability,
    });
  });

  try {
    const response = await page.goto(request.targetUrl, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    if (response === null || response.status() !== 200) {
      return {
        type: 'opened',
        result: 'load_failed',
        observations: snapshot(),
      };
    }
  } catch {
    return { type: 'opened', result: 'load_failed', observations: snapshot() };
  }
  return { type: 'opened', result: 'ok', observations: snapshot() };
};

/** The visible option controls. */
const optionControls = (page: Page) =>
  page.locator(OPTION_SELECTOR).filter({ visible: true });

const controlFor = (page: Page, label: string): Locator =>
  optionControls(page).filter({
    has: page.locator('.label').getByText(label, { exact: true }),
  });

const textControls = (page: Page) => ({
  input: page.locator(`#${TEXT_INPUT_ID}`).filter({ visible: true }),
  submit: page.locator(`#${TEXT_SUBMIT_ID}`).filter({ visible: true }),
});

/** The visible prompt, a screenshot of the quiz, and its visible controls. */
const capture = async (page: Page): Promise<HostReply> => {
  try {
    const prompt = (
      await page
        .locator(PROMPT_SELECTOR)
        .innerText({ timeout: CAPTURE_TIMEOUT_MS })
    ).trim();
    const labels = (
      await optionControls(page).locator('.label').allInnerTexts()
    ).map((label) => label.trim());
    const { input, submit } = textControls(page);
    const hasText = (await input.count()) === 1 && (await submit.count()) === 1;
    const screenshot = await page
      .locator(QUIZ_SELECTOR)
      .screenshot({ type: 'png', timeout: CAPTURE_TIMEOUT_MS });
    return {
      type: 'captured',
      result: 'ok',
      prompt,
      screenshot: screenshot.toString('base64'),
      labels,
      textControls: hasText,
    };
  } catch {
    return { type: 'captured', result: 'failed' };
  }
};

/**
 * Acts through the quiz's own controls only: a choice clicks that label's
 * option, an order clicks every option once in order, text fills the quiz's
 * input and presses its submit button. Every control must be exactly one
 * visible element, or nothing is done. Then waits for the submission and a
 * quiet window, so whatever the action set off is observed.
 */
const act = async (page: Page, action: Action): Promise<HostReply> => {
  let perform: () => Promise<void>;
  if (action.kind === 'transcribe') {
    const { input, submit } = textControls(page);
    if ((await input.count()) !== 1 || (await submit.count()) !== 1) {
      return {
        type: 'acted',
        result: 'no_single_control',
        observations: snapshot(),
      };
    }
    perform = async () => {
      await input.fill(action.text, { timeout: CLICK_TIMEOUT_MS });
      await submit.click({ timeout: CLICK_TIMEOUT_MS });
    };
  } else {
    const labels = action.kind === 'choose' ? [action.label] : action.labels;
    const controls = labels.map((label) => controlFor(page, label));
    for (const control of controls) {
      if ((await control.count()) !== 1) {
        return {
          type: 'acted',
          result: 'no_single_control',
          observations: snapshot(),
        };
      }
    }
    perform = async () => {
      for (const control of controls) {
        await control.click({ timeout: CLICK_TIMEOUT_MS });
      }
    };
  }

  try {
    await Promise.all([
      page.waitForResponse(
        (response) => response.url() === `${LAB_ORIGIN}${LAB_SUBMIT_PATH}`,
        { timeout: SUBMIT_TIMEOUT_MS }
      ),
      perform(),
    ]);
  } catch (error) {
    const code = error instanceof Error ? error.name : 'unknown';
    return { type: 'acted', result: 'failed', code, observations: snapshot() };
  }

  // Browser events reach us in no fixed order with the submit response, so
  // watch a quiet window before reporting what the action set off.
  await page.waitForTimeout(AFTER_ACTION_QUIET_MS);
  return { type: 'acted', result: 'ok', observations: snapshot() };
};

const handle = async (request: HostRequest): Promise<HostReply> => {
  if (request.type === 'open') {
    // Only the registered lab URL, only once.
    if (request.targetUrl !== LAB_URL || session !== undefined) return quit(2);
    return open(request);
  }
  if (request.type === 'observe') {
    return { type: 'observations', observations: snapshot() };
  }
  if (request.type === 'close') {
    await session?.context.close().catch(() => undefined);
    return { type: 'closed' };
  }

  if (session === undefined) return quit(2);
  if (request.type === 'capture') return capture(session.page);
  return act(session.page, request.action);
};

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    quit(2);
  }
  const request = HostRequest.safeParse(parsed);
  if (!request.success) quit(2);
  else {
    const message = await handle(request.data);
    reply(message);
    if (message.type === 'closed') quit(0);
  }
}
// The runner closed stdin: end with the browser.
await session?.context.close().catch(() => undefined);
quit(0);
