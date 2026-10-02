# Onboarding browser checks

From apps/web run `bunx --bun vite --config src/features/setup/browser-test/vite.config.ts`, then open http://127.0.0.1:3005.

This mounts the production OnboardingFlow with local query adapters. It makes no
account, OAuth, invitation, billing, or analytics requests. Google buttons reload
with a fixture account; connector buttons mark a fixture connection; checkout
reloads with a confirmed fixture license. The Test events panel records completion.
This validates layout, navigation, and return handling, not provider integrations.

Check every step, Back, feature selection, accent selection, both Google returns,
connector search/connection, team creation, Guest comparison/continuation, and
checkout completion. Repeat with a narrow viewport and reduced motion. Clear the
fixture origin's session storage to restart after completing it.
