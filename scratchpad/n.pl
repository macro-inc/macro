undef $/; $_=<STDIN>;
s/export async function goOffline\(context: BrowserContext\): Promise<void> \{\n/export async function goOffline(context: BrowserContext): Promise<void> {\n  \/\/ DEBUG COPY ONLY: let the app finish loading its code first.\n  for (const page of context.pages()) {\n    try {\n      await page.waitForLoadState('networkidle', { timeout: 20_000 });\n    } catch {\n      console.log('DBG networkidle not reached');\n    }\n  }\n/ or die "x";
print;
