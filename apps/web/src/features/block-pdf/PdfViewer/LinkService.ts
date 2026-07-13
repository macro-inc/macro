import { openExternalUrl } from '@core/util/url';
import { PDFLinkService } from 'pdfjs-dist/web/pdf_viewer';
import type { IEventBus } from './EventBus';

// LinkController fixes
export class LinkService extends PDFLinkService {
  declare eventBus: IEventBus;

  goToPage(val: string) {
    super.goToPage(val);
  }

  get page() {
    return this.pdfViewer.currentPageNumber;
  }

  jumpToPage(pageNumber: number) {
    this.eventBus.dispatch('scrollmatch', {
      source: this,
      element: null,
      pageIndex: pageNumber - 1,
      matchIndex: 0,
      selectedLeft: 0,
    });
  }

  set page(value: any) {
    this.pdfViewer.currentPageNumber = value;
    this.jumpToPage(value);
  }

  addLinkAttributes(
    link: HTMLAnchorElement,
    url: string,
    _newWindow?: boolean | undefined
  ) {
    let external = true;
    // Valid URLs are external, otherwise assume PDF-weirdness
    try {
      new URL(url);
    } catch {
      external = false;
    }

    super.addLinkAttributes(link, url, _newWindow);

    // Without this, external URLs will open inside of the Macro tab's view which
    // enables phishing attacks among other things we don't want
    if (external) {
      link.onclick = (e) => {
        e.preventDefault();
        openExternalUrl(url);
      };
    }
  }
}
