/**
 * Prints the public PostHog project key the production web app embeds, so a
 * local benchmark build evaluates the same feature flags as the shipped app.
 */
const ORIGIN = 'https://macro.com';
const KEY = /phc_[A-Za-z0-9]{20,}/;

export async function productionPosthogKey(): Promise<string | undefined> {
  const html = await (await fetch(`${ORIGIN}/app/`)).text();
  const scripts = new Set(
    [...html.matchAll(/"(\/app\/[^"]+\.js)"/g)].map((match) => match[1])
  );
  for (const script of scripts) {
    const source = await (await fetch(`${ORIGIN}${script}`)).text();
    const key = KEY.exec(source)?.[0];
    if (key) return key;
  }
  return undefined;
}

if (import.meta.main) {
  const key = await productionPosthogKey();
  if (!key) {
    console.error(
      'No PostHog key found in the production bundle; set VITE_POSTHOG_API_KEY'
    );
    process.exit(1);
  }
  console.log(key);
}
