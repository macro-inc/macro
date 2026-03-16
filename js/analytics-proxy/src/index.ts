const PROVIDERS: Record<string, string> = {
  '/ingest/ph': 'us.i.posthog.com',
};

function getProvider(pathname: string): { apiHost: string; path: string } | null {
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
