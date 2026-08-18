import { ENABLE_PROXY_EMAIL_IMAGES } from '../constant/featureFlags';
import { proxyEmailImages } from './proxy-email-images';

/**
 * Strips @media (prefers-color-scheme: ...) rules from CSS content.
 * This prevents email dark mode styles from conflicting with our forced backgrounds.
 */
export function stripColorSchemeMediaQueries(cssContent: string): string {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssContent);

    const filteredRules: string[] = [];
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSMediaRule) {
        if (rule.conditionText?.includes('prefers-color-scheme')) {
          continue;
        }
      }
      filteredRules.push(rule.cssText);
    }
    return filteredRules.join('\n');
  } catch {
    // Fallback if parsing fails
    return cssContent;
  }
}

export function trimTrailingBrs(element: Element) {
  function removeTrailingContent(): boolean {
    let removedSomething = false;
    let currentElement: Element = element;

    // Follow the rightmost path down the tree
    while (true) {
      let lastChild = currentElement.lastChild;

      // Remove empty text nodes and br elements from the end
      while (lastChild) {
        if (lastChild.nodeType === Node.TEXT_NODE) {
          if (lastChild.textContent?.trim() === '') {
            // Remove empty text node
            currentElement.removeChild(lastChild);
            lastChild = currentElement.lastChild;
            removedSomething = true;
          } else {
            // Found meaningful text content, stop
            return removedSomething;
          }
        } else if (lastChild.nodeType === Node.ELEMENT_NODE) {
          const lastElement = lastChild as Element;
          const tag = lastElement.tagName.toLowerCase();
          if (tag === 'br') {
            // Remove br element
            currentElement.removeChild(lastChild);
            lastChild = currentElement.lastChild;
            removedSomething = true;
          } else if (tag === 'img') {
            return removedSomething;
          } else {
            // Found a non-br element, go deeper
            currentElement = lastElement;
            break;
          }
        } else {
          return removedSomething;
        }
      }

      // If we removed all children, this element is now empty
      if (!currentElement.lastChild) {
        // If this is a meaningful leaf like <img>, stop
        if ((currentElement as Element).tagName?.toLowerCase() === 'img') {
          return removedSomething;
        }
        // If this is the root element, we're done
        if (currentElement === element) {
          break;
        }
        // Otherwise, remove this empty element and go back up
        const parent = currentElement.parentElement;
        if (parent) {
          parent.removeChild(currentElement);
          currentElement = parent;
          removedSomething = true;
        } else {
          break;
        }
      }
    }

    return removedSomething;
  }

  // Keep removing until no more changes are made
  let changed = true;
  while (changed) {
    changed = removeTrailingContent();
  }

  return element;
}

// Splits a trailing signature out of the body so the renderer can collapse it
// behind the "…" expander. Recognizes Gmail's `.gmail_signature` as well as the
// `.macro-email-signature` wrapper the backend injects into outgoing mail
// (our own signatures aren't otherwise tagged as Gmail's).
function parseGmailSignature(htmlElement: Element) {
  const signaturePrefix = htmlElement.querySelector('.gmail_signature_prefix');
  const signatureElement = htmlElement.querySelector(
    '.gmail_signature, .macro-email-signature'
  );

  if (signatureElement) {
    const signature = signatureElement?.outerHTML;
    signatureElement?.remove();
    signaturePrefix?.remove();

    return {
      mainContent: htmlElement.innerHTML,
      signature: signature,
    };
  }

  return {
    mainContent: htmlElement.innerHTML,
    signature: null,
  };
}

/** Elements that can execute or embed active content, and are never legitimate
 * email body markup. `svg` and `math` are here because their subtrees can
 * mutate an attribute after we validate it (`<animate attributeName="href">`),
 * so a per-attribute check is not enough — matches the backend allowlist,
 * which drops both. */
const ACTIVE_ELEMENTS =
  'script,iframe,frame,frameset,object,embed,applet,base,meta,link,noscript,template,svg,math';

/** Attributes carrying a URL that must be scheme-checked. */
const URL_ATTRIBUTES = ['href', 'src', 'action', 'background', 'poster'];

/** Schemes the backend sanitizer allows; anything else is dropped. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'cid:', 'tel:', 'sms:'];

function isSafeUrl(value: string): boolean {
  // Strip the whitespace and control characters browsers tolerate inside URLs
  // ("java\nscript:") before looking for a scheme.
  const trimmed = Array.from(value)
    .filter((char) => char.charCodeAt(0) > 0x20)
    .join('');
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(trimmed)?.[0]?.toLowerCase();
  // No scheme means relative, anchor, or protocol-relative — all inert.
  if (!scheme) return true;
  // Inline images are inert as an <img> source; other data: URLs are not.
  if (trimmed.toLowerCase().startsWith('data:image/')) return true;
  return SAFE_SCHEMES.includes(scheme);
}

/**
 * Removes script-capable markup from a freshly parsed, still-inert document.
 *
 * Defence in depth for the `innerHTML` render path: the backend sanitizes every
 * body it writes today, but rows stored before that landed — and anything a
 * future write path forgets — would otherwise execute in the reader's page.
 * Must run on a `DOMParser` document, which neither executes scripts nor loads
 * resources; scrubbing after an `innerHTML` assignment is already too late
 * because `<img onerror>` fires on a detached element.
 */
export function scrubActiveContent(doc: Document) {
  for (const element of Array.from(doc.querySelectorAll(ACTIVE_ELEMENTS))) {
    element.remove();
  }

  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const name of element.getAttributeNames()) {
      const lowered = name.toLowerCase();
      if (
        lowered.startsWith('on') ||
        lowered === 'srcdoc' ||
        lowered === 'formaction' ||
        lowered.endsWith(':href')
      ) {
        element.removeAttribute(name);
        continue;
      }
      if (
        URL_ATTRIBUTES.includes(lowered) &&
        !isSafeUrl(element.getAttribute(name) ?? '')
      ) {
        element.removeAttribute(name);
      }
    }
  }
}

/**
 * Parses `html`, scrubs it with {@link scrubActiveContent}, and re-serializes.
 *
 * For the paths that hand a stored body straight to another renderer (the
 * composer's quoted reply, the html-render node) rather than going through
 * {@link parseEmailContent}.
 */
export function sanitizeEmailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  scrubActiveContent(doc);
  return doc.documentElement.innerHTML;
}

interface ParsedEmailContent {
  mainContent: string;
  signature: string | null;
  hasTable: boolean;
}

export function parseEmailContent(
  htmlContent: string,
  removeSignature: boolean = true,
  removeTrailingBrs: boolean = true
): ParsedEmailContent {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  // Scrub while the document is still inert — everything below round-trips
  // through innerHTML on the live document.
  scrubActiveContent(doc);

  const hasTable = Boolean(doc.querySelector('table'));

  // Extract style tags from head, stripping prefers-color-scheme media queries
  // to prevent email dark mode styles from conflicting with our forced backgrounds
  const styleTags = Array.from(doc.head?.querySelectorAll('style') ?? [])
    .map((style) => {
      const filtered = stripColorSchemeMediaQueries(style.textContent ?? '');
      return filtered ? `<style>${filtered}</style>` : '';
    })
    .filter(Boolean)
    .join('\n');

  let mainContent = doc.body?.innerHTML ?? doc.documentElement?.innerHTML;
  let signature: string | null = null;

  if (removeSignature) {
    const { mainContent: signatureMainContent, signature: signatureContent } =
      parseGmailSignature(doc.body ?? doc.documentElement);
    mainContent = signatureMainContent;
    signature = signatureContent;
  }

  // Trim trailing <br> elements from main content
  const mainContentDiv = document.createElement('div');
  mainContentDiv.innerHTML = mainContent;

  if (removeTrailingBrs) {
    trimTrailingBrs(mainContentDiv);
  }

  // Prepend style tags to the main content
  const finalContent = styleTags
    ? `${styleTags}\n${mainContentDiv.innerHTML}`
    : mainContentDiv.innerHTML;

  if (ENABLE_PROXY_EMAIL_IMAGES) {
    mainContent = proxyEmailImages(finalContent);
    signature = signature ? proxyEmailImages(signature) : null;
  } else {
    mainContent = finalContent;
  }

  return {
    mainContent,
    signature,
    hasTable,
  };
}
