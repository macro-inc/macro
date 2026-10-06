import { type JSX, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import { isMobileViewport } from '../../utils/utilBreakpoint';

/*
 * Prerender viewport gates.
 *
 * The static HTML is built once with no real viewport, so components whose
 * mobile/desktop variants differ structurally render BOTH during SSR and CSS
 * picks the right one before the JS bundle loads: SsgMobile wraps its children
 * in .ssg-mobile (hidden at >= 700px), SsgDesktop in .ssg-desktop (hidden
 * below). In the browser only the matching variant mounts, so the wrappers
 * are inert (display: contents keeps them out of layout). The media queries
 * live in src/app/main/index.css and the prerenderer's critical CSS.
 *
 * By default the client condition is isMobileViewport(), mirroring the CSS
 * cutoff. Pass `when` to substitute a different client-side condition (extra
 * signals, a caller-supplied accessor); it replaces the default entirely and
 * must still agree with the 700px gate on what "mobile" means. Conditions
 * that should hide the branch on the server too (for example a per-block
 * feature flag) belong in an outer <Show>, not in `when`.
 */

export function SsgMobile(props: { when?: boolean; children: JSX.Element }) {
  return (
    <Show when={isServer || (props.when ?? isMobileViewport())}>
      <div class="ssg-mobile">{props.children}</div>
    </Show>
  );
}

export function SsgDesktop(props: { when?: boolean; children: JSX.Element }) {
  return (
    <Show when={isServer || (props.when ?? !isMobileViewport())}>
      <div class="ssg-desktop">{props.children}</div>
    </Show>
  );
}
