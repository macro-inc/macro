# Do email clients zoom HTML mail to fit the pane?

Question from Peter on PR 5890: do we need leftover-canvas `zoom` at all? Other clients do not do this.

Date: 2026-08-25. First-party sources only, unless a row says otherwise.

Three mechanisms, not one:

1. CSS `zoom` or `transform: scale` on the message body. This is Macro leftover-canvas zoom.
2. WebView or WKWebView viewport scale (overview mode, shrink-to-fit, Gmail Auto-fit). Text can get smaller. This is a platform scale, not leftover CSS after containment.
3. Native type plus wrap, `max-width` rewrite, or `overflow-x` scroll.

## Answer

Open web and desktop readers use mechanism 3. They do not apply leftover CSS `zoom` to the letter.

Some mobile WebView readers can use mechanism 2. Gmail Android documents an Auto-fit toggle that "resized" messages. Thunderbird Android turns on WebView `loadWithOverviewMode` when Auto-fit is on.

Thunderbird Stormbox (a new web client spec) uses mechanism 1: CSS `zoom` on the iframe `documentElement`.

Peter is right about Zero, Proton, Thunderbird desktop, Roundcube, and SnappyMail. He is not right if the comparison is Gmail Android Auto-fit or Thunderbird Android overview mode.

## Per client

| Client | Whole-letter CSS zoom? | What they do on a wide table / wide `pre` | Source |
| --- | --- | --- | --- |
| Zero (web, staging) | No | Shadow host. `overflow-scroll`. Injected CSS is theme only. No `zoom`. No table `max-width`. Wide content scrolls. | [mail-content.tsx](https://raw.githubusercontent.com/Mail-0/Zero/staging/apps/mail/components/mail/mail-content.tsx), [email-processor.ts](https://raw.githubusercontent.com/Mail-0/Zero/staging/apps/server/src/lib/email-processor.ts) |
| Proton Mail (web) | No | Iframe. `viewport=width=device-width`. Wrappers `width: 100%`. `body { overflow: auto hidden }`. `pre, code { white-space: pre-wrap }`. Images `max-inline-size: none`. Wide content scrolls. | [getIframeHtml.ts](https://raw.githubusercontent.com/ProtonMail/WebClients/main/packages/mail-renderer/helpers/getIframeHtml.ts), [MessageIframe.raw.scss](https://raw.githubusercontent.com/ProtonMail/WebClients/3da5ab65ef6ebe8203288d4f4f8c4ccf74365770/packages/mail-renderer/helpers/MessageIframe.raw.scss) |
| Thunderbird desktop | No | `:root { overflow: auto !important }`. Images can `shrinktofit` to `max-inline-size: 100%`. User `fullZoom` / `textZoom` only. | [messageBody.css](https://raw.githubusercontent.com/mozilla/releases-comm-central/master/mail/themes/shared/mail/messageBody.css), [viewZoomOverlay.js](https://raw.githubusercontent.com/mozilla/releases-comm-central/master/mail/base/content/viewZoomOverlay.js), [Bug 1945321](https://bugzilla.mozilla.org/show_bug.cgi?id=1945321) |
| Thunderbird Stormbox (spec) | Yes | CSS `zoom` on the iframe `documentElement`. Ratio is column / max(content width, 400px). Zoom stays 1 when the ratio is at least 1. Iframe has no scrollbar. | [R-10.11](https://github.com/thunderbird/stormbox/blob/main/specs/001-mvp-scope/spec.md) |
| Thunderbird / K-9 Android | No CSS zoom | If Auto-fit is on: `useWideViewPort = true` and `loadWithOverviewMode = true`. Pinch zoom stays on. Viewport meta is `width=device-width`. | [MessageWebView.kt](https://raw.githubusercontent.com/thunderbird/thunderbird-android/main/legacy/ui/legacy/src/main/java/com/fsck/k9/view/MessageWebView.kt), [DisplayHtml.kt](https://raw.githubusercontent.com/thunderbird/thunderbird-android/main/legacy/core/src/main/java/com/fsck/k9/message/html/DisplayHtml.kt) |
| Roundcube Elastic | No | Iframe `width: 100%; height: 100%`. `div.rcmBody { overflow: auto hidden }`. | [layout.less](https://raw.githubusercontent.com/roundcube/roundcubemail/master/skins/elastic/styles/layout.less), [styles.less](https://raw.githubusercontent.com/roundcube/roundcubemail/master/skins/elastic/styles/styles.less) |
| SnappyMail (Rainloop fork) | No | Parser rewrites large pixel widths to `width: 100%; max-width: <old>`. Constrains layout. Does not scale the letter. | [Html.js](https://raw.githubusercontent.com/the-djmaze/snappymail/master/dev/Common/Html.js) |
| Gmail Android | Closed. Official: Auto-fit "resized" | Setting text: "When this setting is on, messages are resized to make them easier to read." Mechanism unpublished. | [Gmail Android settings](https://support.google.com/mail/answer/6562?hl=en&co=GENIE.Platform%3DAndroid) |
| Gmail web | Closed | Workspace docs tell senders to avoid fixed-width tables because recipients can need horizontal scroll. | [Workspace reading tips](https://support.google.com/a/users/answer/11339703) |
| Gmail CSS (senders) | N/A | Senders can use media queries and a `zoom` CSS property in the email. That is author CSS, not client leftover zoom. | [Gmail CSS support](https://developers.google.com/gmail/design/css) |
| Apple Mail / iOS Mail | Closed | Mail.app source is unpublished. Safari / WebKit can shrink-to-fit wide content by lowering initial scale. Whether Mail turns that on is unverified. | [Safari 9 notes](https://developer.apple.com/library/archive/releasenotes/General/WhatsNewInSafari/Articles/Safari_9_0.html), [ViewportConfiguration.cpp](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/page/ViewportConfiguration.cpp) |
| Outlook Classic (Windows) | Closed | Official: Outlook uses Word as the HTML editor. No first-party doc that Word CSS-zooms the letter to the pane. | [Outlook / Word HTML](https://learn.microsoft.com/en-us/troubleshoot/outlook/user-interface/formatting-lost-when-editing-the-htmlbody-property) |
| Outlook mobile | Closed | Official: body font follows the device font size. That is text size, not letter zoom. Wide-table fit unpublished. | [Outlook font size](https://support.microsoft.com/en-us/office/can-i-change-my-font-size-8e76150b-9bbc-49e9-b3bf-488d382e0cd5) |
| Fastmail | Closed | No public reader source found. | n/a |
| CSS `zoom` | N/A | Baseline 2024. Affects layout. `transform: scale()` does not. Pinch-zoom is a different visual-viewport model. | [MDN zoom](https://developer.mozilla.org/en-US/docs/Web/CSS/zoom), [CSS Viewport draft](https://drafts.csswg.org/css-viewport/#zoom-property) |

## Zero, in the files

`MailContent` attaches an open shadow root and writes `processedHtml`. No `scrollWidth`. No `style.zoom`.

The host class includes `overflow-scroll`:

```tsx
<div ref={hostRef} className={cn('mail-content w-full flex-1 overflow-scroll no-scrollbar px-4 ...')} />
```

`applyEmailPreferences` injects `:host` theme rules, `box-sizing`, link color, `table { border-collapse: collapse }`, and quote `<details>`. It does not set `zoom`, `transform`, or table `max-width`.

Zero is a source for wrap-or-scroll, not leftover zoom.

## What this does not prove

Gmail Auto-fit internals. Official text is only "resized."

Apple Mail.app and iOS Mail WKWebView flags.

Outlook Word layout of a wide table.

Outlook on the web and New Outlook Chromium reader CSS.

Fastmail reader.

Proton native apps. The web client is open.

Stormbox R-10.11 is a spec for Thunderbird's new web client. It is not shipping Thunderbird desktop.

Secondary email-dev write-ups about Gmail Android font bumps are not Google documents. They are omitted as evidence.

## Implication for Macro

After `pre` / `code` wrap, leftover `zoom` only exists for wide designed tables.

If the comparison is Zero, Proton, Thunderbird desktop, Roundcube, or SnappyMail: drop leftover `zoom`. Keep wrap. Keep `overflow-x: auto` at native type.

If the comparison is Gmail Android Auto-fit or Thunderbird Android: those can shrink a wide letter, as a user toggle, through WebView scale. They are not leftover CSS `zoom` floored at 0.7.

If Macro wants Stormbox-style "never a horizontal scrollbar," keep leftover zoom. Use a content-width floor (Stormbox uses 400px), not a 0.7 type floor, or make the mode explicit and off by default.

Recommendation: drop leftover-canvas CSS zoom. Keep wrap and horizontal scroll. Do not copy Gmail Auto-fit unless product wants an explicit, optional "fit to pane" control.
