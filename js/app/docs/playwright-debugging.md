## Verifying Changes & Debugging
- Write and run tests incrementally for business logic using `bun run test`.
- You can use the playwright MCP to debug and verify UI changes and general app behavior.
- Delegate to the user to run the app locally and authenticate.
- The app will likely run on `localhost:3000/app`
- When asked to navigate to "the app" with Playwright, go to `/app/component/unified-list` to avoid the signup flow.
- **Before navigating with Playwright**, always generate an access token first using `bun scripts/generate-access-token.ts` or prompt the user to authenticate. Never navigate without authentication set up.
- You can use `console.trace` to debug state and changes in the ui and logic.
- When building out UI features, use playwright to verify UI behavior.
- Use the `bun run test` command to use the vitest test runner. For example, `bun run test -- packages/core/tests/date.test.ts -c packages/core`

### Playwright Authentication
The app uses cookie-based authentication (`credentials: 'include'`) since `ENABLE_BEARER_TOKEN_AUTH` is false. For Playwright testing, intercept requests and add the Authorization header.

**Steps to authenticate in Playwright:**
1. Run `bun scripts/generate-access-token.ts` to get an access token (requires `.env` with `REFRESH_TOKEN` and `FUSIONAUTH_DOMAIN`)
2. Use `browser_run_code` to set up request interception **before** navigating:
   ```javascript
   async (page) => {
     const token = "YOUR_ACCESS_TOKEN_HERE";
     await page.route('**/*.macro.com/**', async (route) => {
       const headers = {
         ...route.request().headers(),
         'Authorization': `Bearer ${token}`
       };
       await route.continue({ headers });
     });
   }
   ```
3. Navigate to `http://localhost:3000/app/component/unified-list` - you will likely be redirected to `/app/signup` initially
4. **Force navigate again** to `http://localhost:3000/app/component/unified-list` using `browser_run_code`:
   ```javascript
   async (page) => {
     await page.goto('http://localhost:3000/app/component/unified-list', { waitUntil: 'domcontentloaded' });
     return page.url();
   }
   ```
   This second navigation will work because the route interception is now active and auth requests succeed.

**Why this is needed:** The app checks authentication via API calls to `.macro.com` endpoints using `credentials: 'include'`. Without valid cookies or an auth header, `useIsAuthenticated()` returns false and the `Soup` component redirects to `/` → `/signup`. The initial redirect happens before route interception can authenticate the first requests, but forcing a second navigation resolves this.

**Note:** WebSocket connections (for real-time features) won't be authenticated with this approach since Playwright's route interception only works for HTTP/HTTPS. This is fine for most UI testing scenarios.
