import { MacroError } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** Hosts a Macro app link may name, besides the client's own web app. */
const MACRO_HOSTS = ['macro.com', 'dev.macro.com', 'staging.macro.com'];

/**
 * A Macro app link, reduced to the app path it opens: a list view such as
 * Tasks or Mail, or an item. Made by `macro.ui.link(url)`; it keeps no origin.
 *
 * @mcp-exclude Only `macro.ui.open` takes it, which MCP leaves out.
 */
export class AppLink {
  private constructor(
    private readonly client: MacroClient,
    /** The path after `/app`, with its query, such as `/tasks?s0.tasks.tab=mine`. */
    readonly path: string,
  ) {}

  /**
   * Parse a Macro app link (`https://macro.com/app/...`). Throws on anything
   * else: another site, a path outside `/app`, or a link with a fragment.
   */
  static parse(client: MacroClient, url: string): AppLink {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new MacroError(`Not a Macro app link: ${url}`);
    }

    const own = new URL(client.webAppUrl);
    const ownHost = own.hostname;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const macroHost = host === ownHost || MACRO_HOSTS.includes(host);
    const appPath =
      parsed.pathname === '/app' || parsed.pathname.startsWith('/app/');
    const secure =
      parsed.protocol === 'https:' ||
      // A local web app is served over http.
      (parsed.protocol === 'http:' &&
        own.protocol === 'http:' &&
        host === ownHost);
    if (!macroHost || !appPath || !secure || parsed.hash !== '') {
      throw new MacroError(`Not a Macro app link: ${url}`);
    }

    const path = parsed.pathname.slice('/app'.length) || '/';
    return new AppLink(client, `${path}${parsed.search}`);
  }

  /** The link on this client's web app, for a reply. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app${this.path}`;
  }

  toJSON() {
    return { path: this.path, url: this.webUrl() };
  }
}
