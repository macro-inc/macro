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

function parseGmailSignature(htmlElement: Element) {
  const signaturePrefix = htmlElement.querySelector('.gmail_signature_prefix');
  const signatureElement = htmlElement.querySelector('.gmail_signature');

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

export interface ParsedEmailContent {
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

  const hasTable = Boolean(doc.querySelector('table'));

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

  return {
    mainContent: mainContentDiv.innerHTML,
    signature: signature,
    hasTable,
  };
}
