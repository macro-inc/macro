/**
 * Builders for the soup `/soup/ast` raw email-filter tree (`ef`). Mirrors
 * the Rust `Expr<EmailLiteral>` serialization so the FE can construct an
 * any-direction OR-tree for the "Me" tab (which intentionally drops the
 * `ecd` / `eca` CRM-scope widener, so the default per-user mailbox scope
 * applies).
 *
 * Wire shape:
 *   Or(a, b) → { "|": [a, b] }
 *   Literal(EmailLiteral::Sender(Email::Complete("..."))) →
 *     { l: { Sender: { Complete: "..." } } }
 */

type EmailValue = { Complete: string } | { Domain: string };

/**
 * OR-tree across Sender / Cc / Bcc / Recipient for a single email value.
 * Mirrors the Rust `any_direction(e)` helper in `item_filters::ast::email`.
 */
function anyDirection(value: EmailValue): unknown {
  return {
    '|': [
      {
        '|': [{ l: { Sender: value } }, { l: { Cc: value } }],
      },
      {
        '|': [{ l: { Bcc: value } }, { l: { Recipient: value } }],
      },
    ],
  };
}

/** Any-direction match for a single fully-qualified email address. */
export function emailFilterForAddress(email: string): unknown {
  return anyDirection({ Complete: email });
}

/**
 * Any-direction match for any of the given domains. Returns `undefined`
 * when the list is empty so the caller can skip setting `ef` entirely.
 */
export function emailFilterForDomains(domains: string[]): unknown | undefined {
  if (domains.length === 0) return undefined;
  const trees = domains.map((d) => anyDirection({ Domain: d }));
  return trees.reduce((acc, cur) => ({ '|': [acc, cur] }));
}
