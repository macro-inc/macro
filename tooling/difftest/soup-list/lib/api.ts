/**
 * The services, called from the driver as another device would call them: a
 * synthetic user signs in with the local stack's passwordless flow (the login
 * response carries the code) and keeps its own cookie jar.
 */
import { readFileSync } from 'node:fs';

const CA = readFileSync(
  new URL('../../../../infra/local/certs/ca.pem', import.meta.url),
  'utf8'
);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string
  ) {
    super(`${status} ${path}: ${body.slice(0, 300)}`);
  }
}

export class ApiUser {
  readonly id: string;
  private cookies = new Map<string, string>();

  constructor(
    readonly origin: string,
    readonly email: string
  ) {
    this.id = `macro|${email}`;
  }

  /** Cookies as Playwright wants them, for signing a browser context in. */
  browserCookies(domain = 'localhost') {
    return [...this.cookies].map(([name, value]) => ({
      name,
      value,
      domain,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    }));
  }

  private absorb(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async raw(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type'))
      headers.set('content-type', 'application/json');
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.set('cookie', cookie);
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        ...init,
        headers,
        redirect: 'manual',
        // @ts-expect-error Bun's TLS option: trust the checked-in local CA.
        tls: { ca: CA },
      });
    } catch (error) {
      if (attempt < 4) {
        await Bun.sleep(250 * 2 ** attempt);
        return this.raw(path, init, attempt + 1);
      }
      throw error;
    }
    this.absorb(response);
    if ((response.status === 429 || response.status >= 502) && attempt < 6) {
      await Bun.sleep(300 * 2 ** attempt);
      return this.raw(path, init, attempt + 1);
    }
    if (response.status === 401 && attempt === 0 && !path.startsWith('/auth/')) {
      await this.raw('/auth/jwt/refresh', { method: 'POST' }, 1);
      return this.raw(path, init, attempt + 1);
    }
    return response;
  }

  async json<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.raw(path, init);
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, path, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.json<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  patch<T = unknown>(path: string, body: unknown) {
    return this.json<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
  put<T = unknown>(path: string, body: unknown) {
    return this.json<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }
  del<T = unknown>(path: string, body?: unknown) {
    return this.json<T>(path, {
      method: 'DELETE',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  get<T = unknown>(path: string) {
    return this.json<T>(path);
  }

  async login(attempt = 0): Promise<this> {
    let code: string;
    try {
      ({ code } = await this.post<{ code: string }>('/auth/login/passwordless', {
        email: this.email,
        redirect_uri: `${this.origin}/app`,
      }));
    } catch (error) {
      // Creating many users at once can lose a race in the auth service.
      if (attempt >= 4 || !(error instanceof ApiError) || error.status < 500) throw error;
      await Bun.sleep(500 * (attempt + 1));
      return await this.login(attempt + 1);
    }
    await this.get(
      `/auth/oauth/passwordless/${code}?email=${encodeURIComponent(this.email)}&disable_redirect=true`
    );
    return this;
  }

  /** A GraphQL operation against the storage service's endpoint. */
  async graphql<T = unknown>(query: string, variables: unknown): Promise<T> {
    const result = await this.post<{ data?: T; errors?: unknown[] }>('/dss/items/soup/graphql', {
      query,
      variables,
    });
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors).slice(0, 500));
    return result.data as T;
  }
}
