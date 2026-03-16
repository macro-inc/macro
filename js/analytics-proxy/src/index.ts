const API_HOST = 'us.i.posthog.com';
const ASSET_HOST = 'us-assets.i.posthog.com';

async function handleStatic(
  request: Request,
  pathname: string,
  ctx: ExecutionContext
): Promise<Response> {
  let response = await caches.default.match(request);
  if (!response) {
    response = await fetch(`https://${ASSET_HOST}${pathname}`);
    ctx.waitUntil(caches.default.put(request, response.clone()));
  }
  return response;
}

async function handleProxy(request: Request, pathWithSearch: string): Promise<Response> {
  const originHeaders = new Headers(request.headers);
  originHeaders.delete('cookie');
  originHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');

  const originRequest = new Request(`https://${API_HOST}${pathWithSearch}`, {
    method: request.method,
    headers: originHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null,
    redirect: request.redirect,
  });

  return await fetch(originRequest);
}

export default {
  async fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathWithSearch = url.pathname + url.search;

    if (url.pathname.startsWith('/static/')) {
      return handleStatic(request, pathWithSearch, ctx);
    }

    return handleProxy(request, pathWithSearch);
  },
};
