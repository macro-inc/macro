export class PageModel {
  /**
   * Return the page number of the page that the provided `node` is on. If the
   * `node` is null, if the `node` is not on a page, or if the page is poorly
   * formatted for whatever reason, return null.
   */
  public static getPageIndex(node: HTMLElement | null): number | null {
    const pageNode = PageModel.getPageNode(node);
    if (!pageNode) return null;
    const pageNum = parseInt(pageNode.dataset.pageNumber!);
    if (isNaN(pageNum)) return null;
    return pageNum - 1; // we use 0-based indexing, pdf.js uses 1-based
  }

  /**
   * Get the page container DOM node of the page that the provided `node` is on. If the
   * `node` is not contained in a page or if the `node` is null, return null
   */
  public static getPageNode(node: HTMLElement | null): HTMLElement | null {
    while (node != null) {
      if ((node as HTMLElement).dataset?.pageNumber != null) return node;
      node = node.parentElement;
    }
    return node;
  }
}
