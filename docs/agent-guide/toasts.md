# Toast notifications

Desktop notifications appear at the bottom right. Up to three ordinary notices
are mounted at once; additional notices queue until a slot opens. Older notices
peek behind the front card. Hover the stack or focus one of its controls to
expand it and pause dismissal. Moving away resumes the remaining time.

Ordinary notices dismiss after 4.5 seconds unless the caller specifies a duration.
Persistent prompts and reminders keep their separate, single-card queues and
remain until answered or dismissed. A new success notice does not replace a
persistent reconnect prompt. Mobile keeps one transient notice at a time above
the dock and preserves full descriptions and accessible close buttons. On phones,
open sheets and the pickers and menus on them cover prompts and reminders, which
sit above the transient notice; the notice itself stays on top of sheets.

Toasts never cover a composer's send and stop controls. A composer docked at
the bottom of a pane (agent session and new-conversation composers, the phone
agent composer, channel composers) registers with `keepToastsClearOf`; while a
toast stack would overlap one, the stack rises to just above it, on desktop and
phone. Register any new bottom-docked composer the same way. Backend-free
desktop/phone regression over the real `AgentInput` and `ToastRegion`:
`bunx playwright test --config
src/features/block-agent/browser-test/playwright.config.ts
toast-clearance.browser.e2e.ts` from `apps/web`.

Backend-free regression that a toast animating over a heavy page restyles only
the toasts, never the whole page (it counts style passes in a trace, not
milliseconds): `bunx playwright test --config
src/components/view-shell/browser-test/playwright.config.ts
toast-frame-cost.browser.e2e.ts` from `apps/web`. Keep per-frame stack
geometry off `<html>`: a custom property there restyles every element.

All toasts place actions to the right of the message, centered vertically. The
close button floats halfway over the top-right corner; stacked cards leave room
for it when expanded. Close, Escape while focused,
and swipe dismiss a notice. Closing a persistent prompt can record a real
user dismissal; do not dismiss a real reconnect prompt merely to clear a test
screenshot. Motion follows the system's reduced-motion preference.

Use `/app/debug/ui?ui=toast` to preview success, an expandable stack, and a
persistent prompt. Demo actions do not change account state. Demo notices are
removed when their preview unmounts.

Backend-free desktop/phone coverage: `bunx playwright test --config src/components/view-shell/browser-test/playwright.config.ts` from `apps/web`. The fixture uses only local callbacks and demo notices.

![Expandable toast stack](images/toast-stack.png)
