const POSTHOG_PROVIDER_PREFIX = '/i/ph';
const POSTHOG_HOST = 'us.i.posthog.com';
// Privacy filter lists block the upstream filename; keep the browser-facing alias opaque.
const POSTHOG_RECORDER_SCRIPT_NAME = 'posthog-recorder.js';
const POSTHOG_RECORDER_PROXY_SCRIPT_NAME = 'runtime.js';

const PROVIDERS: Record<string, string> = {
  [POSTHOG_PROVIDER_PREFIX]: POSTHOG_HOST,
  // Datadog browser logs intake for the us5 site (site: us5.datadoghq.com).
  // The observability SDK's `proxy` option targets the `/i/dd` prefix.
  '/i/dd': 'browser-intake-us5-datadoghq.com',
};

function getProvider(pathname: string): { apiHost: string; path: string } | null {
  if (
    pathname ===
    `${POSTHOG_PROVIDER_PREFIX}/static/${POSTHOG_RECORDER_PROXY_SCRIPT_NAME}`
  ) {
    return {
      apiHost: POSTHOG_HOST,
      path: `/static/${POSTHOG_RECORDER_SCRIPT_NAME}`,
    };
  }

  for (const [prefix, apiHost] of Object.entries(PROVIDERS)) {
    if (pathname.startsWith(prefix)) {
      return { apiHost, path: pathname.slice(prefix.length) || '/' };
    }
  }
  return null;
}

async function handleProxy(request: Request, apiHost: string, pathWithSearch: string): Promise<Response> {
  const originHeaders = new Headers(request.headers);
  originHeaders.delete('cookie');
  originHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');

  const originRequest = new Request(`https://${apiHost}${pathWithSearch}`, {
    method: request.method,
    headers: originHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null,
    redirect: request.redirect,
  });

  return await fetch(originRequest);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const provider = getProvider(url.pathname);

    if (!provider) {
      return new Response('Not found', { status: 404 });
    }

    return handleProxy(request, provider.apiHost, provider.path + url.search);
  },
};
