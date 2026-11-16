---
name: browser
description: Drive the real Chromium on this Macro computer through the chrome-devtools MCP server (CDP on 127.0.0.1:9222). Use for web tasks, testing a web app you are building, screenshots, or anything that needs a logged-in browser.
---

# Browser

- Chromium runs on display `:0` with a persistent profile in
  `~/.config/chromium`; logins and cookies survive restarts. It is a user
  service: `systemctl --user status macro-chromium`.
- Use the `chrome-devtools` MCP tools (`new_page`, `navigate_page`,
  `take_snapshot`, `click`, `fill`, `take_screenshot`, ...). Prefer
  `take_snapshot` (text) over screenshots to read a page.
- The team can watch and take control of this display from Macro. If a site
  needs a login, a CAPTCHA or 2FA, stop and ask the person to do it on the
  Screen pane; never guess credentials.
- Raw CDP is at `http://127.0.0.1:9222/json`; Playwright or Puppeteer can
  `connectOverCDP` to it.
- Do not use the browser to scrape behind logins, create accounts in bulk,
  or send messages you were not asked to send.
