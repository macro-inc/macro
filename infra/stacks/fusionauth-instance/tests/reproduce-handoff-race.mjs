// Runs only against a new, disposable FusionAuth 1.69.4 Docker project.
// The upstream OIDC server supplies synthetic Google-shaped UserInfo claims.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const directory = fileURLToPath(new URL('.', import.meta.url));
const project = `sso-validation-${randomUUID()}`;
const apiKey = randomUUID();
const configDirectory = await mkdtemp(join(tmpdir(), 'sso-config-'));
await chmod(configDirectory, 0o755);
const kickstart = join(configDirectory, 'kickstart.json');
await writeFile(
  kickstart,
  JSON.stringify({ apiKeys: [{ key: apiKey }], requests: [] }),
  { mode: 0o644 }
);
const compose = (...args) =>
  exec(
    'docker',
    ['compose', '-p', project, '-f', join(directory, 'compose.yaml'), ...args],
    {
      env: {
        ...process.env,
        FUSIONAUTH_TEST_API_KEY: apiKey,
        FUSIONAUTH_TEST_KICKSTART: kickstart,
      },
    }
  );
const captures = await mkdtemp(join(tmpdir(), 'sso-validation-'));
const ids = Object.fromEntries(
  [
    'tenant',
    'app',
    'user',
    'provider',
    'baseline',
    'other',
    'reconcile',
    'guarded',
    'validate',
  ].map((key) => [key, randomUUID()])
);
const claims = new Map();
let pair;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (body) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/authorize') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<html><body>${['primary', 'secondary', 'missing']
        .map((kind) => {
          const code = randomUUID();
          claims.set(code, kind);
          const target = new URL(url.searchParams.get('redirect_uri'));
          target.searchParams.set('code', code);
          target.searchParams.set('state', url.searchParams.get('state'));
          return `<p><a href="${target.href.replaceAll('&', '&amp;')}">${kind}</a></p>`;
        })
        .join('')}</body></html>`
    );
  } else if (url.pathname === '/token') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const code = new URLSearchParams(body).get('code');
    assert(claims.has(code));
    json({ access_token: code, token_type: 'Bearer', expires_in: 300 });
  } else if (url.pathname === '/userinfo') {
    const code = req.headers.authorization?.split(' ')[1];
    const kind = claims.get(code);
    assert(kind);
    // Release both UserInfo calls together: no sleeps or timing-based overlap.
    if (pair?.codes.has(code)) {
      pair.arrivals++;
      if (pair.arrivals === 2) pair.release();
      await pair.ready;
    }
    const payload = {
      sub: kind === 'primary' ? 'primary-sub' : 'secondary-sub',
      email_verified: true,
    };
    if (kind !== 'missing')
      payload.email =
        kind === 'primary' ? 'primary@example.com' : 'secondary@example.com';
    if (kind === 'malformed') payload.email = ['secondary@example.com'];
    if (kind === 'unverified') payload.email_verified = false;
    json(payload);
  } else if (url.pathname === '/callback') {
    res.end('OAuth callback');
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
const upstreamPort = server.address().port;
const callback = `http://localhost:${upstreamPort}/callback`;
let browser;
try {
  await compose('up', '-d', '--wait', '--wait-timeout', '180');
  const { stdout } = await compose('port', 'fusionauth', '9011');
  let base = `http://localhost:${stdout.trim().split(':').at(-1)}`;
  const request = async (method, path, body, tenant = true) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
        ...(tenant ? { 'X-FusionAuth-TenantId': ids.tenant } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  };
  const api = async (...args) => {
    const result = await request(...args);
    assert.equal(
      result.status,
      200,
      `${args[0]} ${args[1]}: ${JSON.stringify(result.body)}`
    );
    return result.body;
  };
  const source = await readFile(
    new URL('../templates/reconcile_secondary_idp_link.js', import.meta.url),
    'utf8'
  );
  for (const [id, type, name, body] of [
    [
      ids.reconcile,
      'OpenIDReconcile',
      'Reconcile with validation',
      await readFile(
        new URL('fixtures/reconcile_secondary_inbox_login.js', import.meta.url),
        'utf8'
      ),
    ],
    [ids.guarded, 'OpenIDReconcile', 'Reconcile with original guard', source],
    [
      ids.validate,
      'LoginValidation',
      'Validate secondary inbox',
      await readFile(
        new URL('fixtures/validate_secondary_inbox_login.js', import.meta.url),
        'utf8'
      ),
    ],
  ])
    await api(
      'POST',
      `/api/lambda/${id}`,
      { lambda: { name, type, body } },
      false
    );
  let themeId;
  if (process.env.FUSIONAUTH_TEST_THEME) {
    themeId = randomUUID();
    const theme = JSON.parse(
      await readFile(process.env.FUSIONAUTH_TEST_THEME, 'utf8')
    );
    await api('POST', `/api/theme/${themeId}`, { theme }, false);
  }
  // A new tenant has no cached pre-validation configuration. Updating an existing
  // tenant and immediately removing the old guard is unsafe; see the README.
  await api(
    'POST',
    `/api/tenant/${ids.tenant}`,
    {
      tenant: {
        name: 'Isolated SSO verification',
        themeId,
        lambdaConfiguration: { loginValidationId: ids.validate },
        emailConfiguration: { verifyEmail: false },
      },
    },
    false
  );
  await api('POST', `/api/application/${ids.app}`, {
    application: {
      name: 'SSO fixture',
      oauthConfiguration: {
        authorizedRedirectURLs: [callback],
        enabledGrants: ['authorization_code', 'refresh_token'],
        clientSecret: 'local-client-secret',
        generateRefreshTokens: true,
      },
      loginConfiguration: {
        allowTokenRefresh: true,
        generateRefreshTokens: true,
      },
      passwordlessConfiguration: { enabled: true },
    },
  });
  await api('POST', `/api/user/registration/${ids.user}`, {
    user: {
      email: 'primary@example.com',
      password: 'Local-password-123!',
      verified: true,
    },
    registration: { applicationId: ids.app },
    skipVerification: true,
  });
  for (const [id, name, reconcileId] of [
    [ids.provider, 'google_gmail', ids.reconcile],
    [ids.baseline, 'guarded_fixture', ids.guarded],
    [ids.other, 'google', undefined],
  ]) {
    await api(
      'POST',
      `/api/identity-provider/${id}`,
      {
        identityProvider: {
          name,
          tenantId: ids.tenant,
          type: 'OpenIDConnect',
          buttonText: name,
          enabled: true,
          linkingStrategy: 'LinkByEmail',
          applicationConfiguration: {
            [ids.app]: { enabled: true, createRegistration: true },
          },
          lambdaConfiguration: { reconcileId },
          oauth2: {
            client_id: 'local-client',
            client_secret: 'local-provider-secret',
            clientAuthenticationMethod: 'client_secret_post',
            authorization_endpoint: `http://localhost:${upstreamPort}/authorize`,
            token_endpoint: `http://host.docker.internal:${upstreamPort}/token`,
            userinfo_endpoint: `http://host.docker.internal:${upstreamPort}/userinfo`,
            scope: 'openid email profile',
            uniqueIdClaim: 'sub',
          },
        },
      },
      false
    );
    for (const sub of ['primary-sub', 'secondary-sub']) {
      await api('POST', '/api/identity-provider/link', {
        identityProviderLink: {
          identityProviderId: id,
          identityProviderUserId: sub,
          userId: ids.user,
        },
      });
    }
  }
  console.log(
    'Fixture created; restarting only its FusionAuth container to load configuration.'
  );
  // Load the completed fixture configuration without stale API-write caches.
  await compose('restart', 'fusionauth');
  await compose('up', '-d', '--wait', '--wait-timeout', '180');
  const restarted = await compose('port', 'fusionauth', '9011');
  base = `http://localhost:${restarted.stdout.trim().split(':').at(-1)}`;
  const codeFor = (kind) => {
    const code = randomUUID();
    claims.set(code, kind);
    return code;
  };
  const login = (kind, provider = ids.provider, code = codeFor(kind)) =>
    request('POST', '/api/identity-provider/login', {
      applicationId: ids.app,
      identityProviderId: provider,
      data: { code, redirect_uri: `${base}/oauth2/callback` },
    });
  const allowed = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert(r.body.token);
    assert.equal(r.body.user.id, ids.user);
    return r;
  };
  const denied = (r, code) => {
    assert(r.status >= 400);
    assert(!r.body.token && !r.body.refreshToken);
    assert(
      r.body.generalErrors.some((e) => e.code === code),
      JSON.stringify(r.body)
    );
    assert(!JSON.stringify(r.body).includes('primary@example.com'));
  };
  denied(await login('secondary', ids.baseline), '[LambdaInvocationException]');
  const primary = allowed(await login('primary'));
  assert.equal(primary.body.user.data.macroPrimaryEmailLogin, true);
  for (const kind of ['secondary', 'secondary', 'missing', 'malformed']) {
    denied(
      await login(kind),
      kind === 'secondary'
        ? '[SecondaryInboxLogin]'
        : '[LambdaInvocationException]'
    );
    allowed(await login('primary'));
  }
  const validateToken = async (token) => {
    const response = await fetch(`${base}/api/jwt/validate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).jwt.sub, ids.user);
  };
  let apiBypasses = 0;
  let primaryRejections = 0;
  for (let i = 0; i < 50; i++) {
    const a = codeFor('primary');
    const b = codeFor('secondary');
    const { promise, resolve } = Promise.withResolvers();
    pair = {
      codes: new Set([a, b]),
      arrivals: 0,
      ready: promise,
      release: resolve,
    };
    const results = await Promise.all([
      login('primary', ids.provider, a),
      login('secondary', ids.provider, b),
    ]);
    assert.equal(pair.arrivals, 2);
    pair = undefined;
    if (results[0].status !== 200) {
      denied(results[0], '[SecondaryInboxLogin]');
      primaryRejections++;
    } else allowed(results[0]);
    if (results[1].status === 200) {
      allowed(results[1]);
      await validateToken(results[1].body.token);
      apiBypasses++;
    } else denied(results[1], '[SecondaryInboxLogin]');
  }
  assert(
    apiBypasses > 0,
    'No race reproduced in this run; do not infer that the handoff is safe.'
  );
  console.log(
    `UNSAFE: ${apiBypasses}/50 secondary API logins minted usable primary-account tokens; ${primaryRejections}/50 primary logins were rejected`
  );
  denied(await login('secondary'), '[SecondaryInboxLogin]');
  allowed(
    await request('POST', '/api/login', {
      applicationId: ids.app,
      loginId: 'primary@example.com',
      password: 'Local-password-123!',
    })
  );
  const passwordless = await api('POST', '/api/passwordless/start', {
    applicationId: ids.app,
    loginId: 'primary@example.com',
    sendEmail: false,
  });
  allowed(
    await request('POST', '/api/passwordless/login', {
      applicationId: ids.app,
      code: passwordless.code,
    })
  );
  allowed(await login('primary', ids.other));
  assert(primary.body.refreshToken);
  const refreshed = await api('POST', '/api/jwt/refresh', {
    refreshToken: primary.body.refreshToken,
  });
  assert(refreshed.token);
  console.log(
    'PASS: password, passwordless, unrelated OIDC provider, refresh after rejection'
  );

  browser = await chromium.launch({ headless: true });
  const authorize = (extra = {}) =>
    `${base}/oauth2/authorize?${new URLSearchParams({ client_id: ids.app, redirect_uri: callback, response_type: 'code', scope: 'openid offline_access', state: 'fixture', ...extra })}`;
  const hosted = async (page, provider, kind) => {
    await page.goto(authorize({ prompt: 'login' }));
    await page.locator(`[data-identity-provider-id="${provider}"]`).click();
    await page.getByText(kind, { exact: true }).click();
  };
  for (const [label, viewport] of [
    ['desktop', { width: 1280, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await hosted(page, ids.provider, 'secondary');
    await page
      .getByText('This Google account is connected as an additional inbox.', {
        exact: false,
      })
      .waitFor();
    assert(!new URL(page.url()).searchParams.has('code'));
    assert(
      !(await page.locator('body').innerText()).includes('primary@example.com')
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    );
    await page.screenshot({
      path: join(captures, `${label}.png`),
      fullPage: true,
    });
    await page.goto(authorize({ prompt: 'none' }));
    await page.waitForURL(`${callback}**`);
    assert.equal(
      new URL(page.url()).searchParams.get('error'),
      'login_required'
    );
    assert(!new URL(page.url()).searchParams.has('code'));
    // Retry in the same browser context with the permitted identity.
    await hosted(page, ids.provider, 'primary');
    await page.waitForURL(`${callback}**`);
    const code = new URL(page.url()).searchParams.get('code');
    assert(code);
    const tokenResponse = await fetch(`${base}/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ids.app,
        client_secret: 'local-client-secret',
        code,
        redirect_uri: callback,
      }),
    });
    assert.equal(tokenResponse.status, 200);
    assert((await tokenResponse.json()).access_token);
    denied(await login('secondary'), '[SecondaryInboxLogin]');
    await page.goto(authorize({ prompt: 'none' }));
    await page.waitForURL(`${callback}**`);
    assert(new URL(page.url()).searchParams.has('code'));
    await context.close();
  }
  let hostedBypasses = 0;
  for (let i = 0; i < 20; i++) {
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]);
    const pages = await Promise.all(
      contexts.map((context) => context.newPage())
    );
    await Promise.all(
      pages.map(async (page) => {
        await page.goto(authorize({ prompt: 'login' }));
        await page
          .locator(`[data-identity-provider-id="${ids.provider}"]`)
          .click();
        await page.getByText('primary', { exact: true }).waitFor();
      })
    );
    const kinds = ['primary', 'secondary'];
    const codes = await Promise.all(
      pages.map(async (page, index) => {
        const href = await page
          .getByText(kinds[index], { exact: true })
          .getAttribute('href');
        return new URL(href).searchParams.get('code');
      })
    );
    const { promise, resolve } = Promise.withResolvers();
    pair = {
      codes: new Set(codes),
      arrivals: 0,
      ready: promise,
      release: resolve,
    };
    await Promise.all(
      pages.map(async (page, index) => {
        await page.getByText(kinds[index], { exact: true }).click();
        await page.waitForURL(
          (url) => url.origin === base || url.pathname === '/callback'
        );
      })
    );
    assert.equal(pair.arrivals, 2);
    pair = undefined;
    const secondaryCode = new URL(pages[1].url()).searchParams.get('code');
    if (secondaryCode) {
      const response = await fetch(`${base}/oauth2/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: ids.app,
          client_secret: 'local-client-secret',
          code: secondaryCode,
          redirect_uri: callback,
        }),
      });
      assert.equal(response.status, 200);
      await validateToken((await response.json()).access_token);
      hostedBypasses++;
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
  assert(
    hostedBypasses > 0,
    'Hosted race did not reproduce in this run; do not infer safety.'
  );
  console.log(
    `UNSAFE: ${hostedBypasses}/20 secondary hosted logins returned codes exchangeable for primary-account access tokens`
  );
  for (let i = 0; i < 20; i++) {
    const a = codeFor('primary');
    const b = codeFor('secondary');
    const { promise, resolve } = Promise.withResolvers();
    pair = {
      codes: new Set([a, b]),
      arrivals: 0,
      ready: promise,
      release: resolve,
    };
    const results = await Promise.all([
      login('primary', ids.baseline, a),
      login('secondary', ids.baseline, b),
    ]);
    assert.equal(pair.arrivals, 2);
    pair = undefined;
    allowed(results[0]);
    denied(results[1], '[LambdaInvocationException]');
  }
  console.log(
    'PASS: original reconciliation guard blocks all 20 overlapping secondary logins'
  );
  const baselineContext = await browser.newContext();
  const baselinePage = await baselineContext.newPage();
  await hosted(baselinePage, ids.baseline, 'secondary');
  await baselinePage
    .getByText(/validation error occurred|couldn't complete sign-in/)
    .waitFor();
  await baselinePage.screenshot({
    path: join(captures, 'baseline.png'),
    fullPage: true,
  });
  await baselineContext.close();
  console.log(
    'PASS: sequential hosted error, rejected session check, retry, token exchange, existing session, desktop/mobile'
  );
  console.log(`Screenshots: ${captures}`);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  try {
    await compose('down');
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
}
