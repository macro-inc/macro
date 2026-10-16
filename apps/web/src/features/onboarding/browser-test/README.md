# Onboarding browser tests

The fixture mounts the real onboarding views under `OnboardingProvider` with the
fake backend from `tests/fake-onboarding-context.ts`. No module is aliased or
mocked, and nothing touches the network: the only difference from production is
the context the provider receives.

The fake world is persisted in sessionStorage, so the full-page round-trips are
real page loads. Google sign-up, inbox OAuth, and native GitHub account linking
reload into the flow, and
checkout returns on Stripe's success or cancel leg. Leaving onboarding renders
a `landed` marker showing where the app would have navigated.

Run the suite from `apps/web` (the config starts or reuses the fixture server).
Add `--ui` to watch and step through each test, or `--headed` to see the browser:

```sh
bunx playwright test --config src/features/onboarding/browser-test/playwright.config.ts
```

To click through by hand, start the fixture and open `http://127.0.0.1:3021/`:

```sh
bunx vite --config src/features/onboarding/browser-test/vite.config.ts
```

- Add `&theme=cream` or `&theme=dark` to preview either palette. Without an override,
  the fixture follows the system color scheme. Overrides survive simulated redirects.
- `/?view=signup` shows the signed-out slides; Google sign-up continues into the flow.
- `/?view=flow&next=/channel/x` shows the signed-in flow with a deep link.

Tests seed the world through `openFixture` in `fixture-page.ts`. They read the
world and the recorded analytics through `window.onboardingFixture`.

Connector logos under `public/connector-icons` are snapshots from Pipedream's
public app directory. `../tests/connector-icons.json` records each original page
and image URL.
The fixture uses these real logos locally, so browser tests need no image network
access. Production uses verified featured metadata and each live directory
response's `icon_url`. The fake flow is not proof of a working third-party OAuth
grant or tool call; Slack release verification requires both against a real account.
