# Onboarding browser tests

The fixture mounts the real onboarding views under `OnboardingProvider` with the
fake backend from `tests/fake-onboarding-context.ts`. No module is aliased or
mocked, and nothing touches the network: the only difference from production is
the context the provider receives.

The fake world is persisted in sessionStorage, so the full-page round-trips are
real page loads. Google sign-up and the inbox OAuth reload into the flow, and
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

- `/?view=signup` shows the signed-out slides; Google sign-up continues into the flow.
- `/?view=flow&next=/channel/x` shows the signed-in flow with a deep link.

Tests seed the world through `openFixture` in `fixture-page.ts`. They read the
world and the recorded analytics through `window.onboardingFixture`.
