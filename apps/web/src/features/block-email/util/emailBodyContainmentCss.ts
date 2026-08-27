/** Shadow-root containment shared with the email rendering snapshot harness.
 *
 * Images already cap at the pane. Long signature lines wrap instead of
 * overflowing the pane. Quote nesting indents left only. GitHub
 * review mail uses one unwrapped `<pre>` line; wrap like Gmail. Leave
 * designed tables alone so newsletters stay at native type and scroll.
 */
export const EMAIL_BODY_CONTAINMENT_CSS = [
  'img{display: var(--macro-email-img-display, initial); max-width: 100% !important; height: auto !important;}',
  '.macro-email-signature{max-width:100%;overflow-x:auto;overflow-wrap:anywhere;}',
  'blockquote{margin-block:0.75em!important;margin-inline-start:1.5em!important;margin-inline-end:0!important;max-width:100%!important;box-sizing:border-box;}',
  'pre,code{white-space:pre-wrap!important;overflow-wrap:anywhere;word-break:break-word;max-width:100%!important;box-sizing:border-box;}',
].join('');
