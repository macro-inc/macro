# Sign-in and sign-up browser tests

The fixture mounts the real `AuthView` and `MobileWebSignupView` under
`AuthProvider` with the fake backend from `tests/fake-auth-context.ts`. New users
continue into the real onboarding views over onboarding's own fake. No module is
aliased or mocked, and nothing touches the network.

SSO is a real round trip. Google and Apple reload the page with the `?token=` the
auth service would append, and the view redeems it. Both fake backends persist in
sessionStorage across these reloads. When a signed-in user would enter the app,
the fixture renders a `landed` marker instead.

Run the suite from `apps/web` (the config starts or reuses the fixture server).
Add `--ui` to watch and step through each test, or `--headed` to see the browser:

```sh
bunx playwright test --config src/features/auth/browser-test/playwright.config.ts
```

To click through by hand, run
`bunx vite --config src/features/auth/browser-test/vite.config.ts` and open
`http://127.0.0.1:3022/`:

- `/?page=login` is sign-in. Use `returning@acme.com` with code `424242`; any
  other address signs up as a first-time user.
- `/?page=signup` is the desktop sign-up through onboarding's opening slides.
- `/?page=mobile-signup` is the mobile-web email capture.
