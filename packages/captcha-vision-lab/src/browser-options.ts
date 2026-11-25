/**
 * How the lab browser is launched. Below the request allowlist, the network
 * itself goes nowhere: every connection but the lab's goes to a dead proxy
 * (nothing listens on the discard port; loopback is proxied too, so other
 * local ports are out of reach), WebRTC may not go around the proxy, and
 * there is no DNS prefetching.
 */
import { LAB_HOST, LAB_PORT } from './registry.ts';

export const isolatedBrowser = () => ({
  proxy: {
    server: 'http://127.0.0.1:9',
    bypass: `<-loopback>,${LAB_HOST}:${LAB_PORT}`,
  },
  args: [
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--dns-prefetch-disable',
  ],
});

/**
 * The only environment variables the browser host, and so the browser, gets.
 * Everything else stays out: a dev shell's LD_LIBRARY_PATH or GIO module
 * paths would load libraries Playwright's Chromium can't use, and proxy or
 * credential variables have no business in the lab browser.
 */
const HOST_ENVIRONMENT = [
  'HOME',
  'PATH',
  'TMPDIR',
  'LANG',
  'TZ',
  'FONTCONFIG_FILE',
  'FONTCONFIG_PATH',
];

export const hostEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    HOST_ENVIRONMENT.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    })
  );
