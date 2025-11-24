/* Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { PDFFindController } from 'pdfjs-dist/web/pdf_viewer';
import type { IEventBus } from './EventBus';
import { normalize } from './normalize';

interface _IPromiseCapability<T = undefined> {
  settled: boolean;
  promise: Promise<T | undefined>;
  resolve: T extends undefined
    ? () => void
    : (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

interface IPromiseCapability<T = undefined>
  extends Readonly<_IPromiseCapability<T>> {}

function createPromiseCapability<T = undefined>(): IPromiseCapability<T> {
  const result: _IPromiseCapability<T> = Object.create(null);
  result.settled = false;
  result.promise = new Promise(function (resolve, reject) {
    result.resolve = function (value: T | undefined) {
      result.settled = true;
      resolve(value);
    } as any;

    result.reject = function (reason) {
      result.settled = true;
      reject(reason);
    };
  });

  return result;
}

// FindController fixes
export class FindController extends PDFFindController {
  declare _eventBus: IEventBus;

  /**
   * Array of arrays where each array represents a single page
   * and the arrays inside of that are the text layers
   */
  _pageContentsAsTextLayer: string[][] | undefined;

  scrollMatchIntoView({
    element = null,
    selectedLeft = 0,
    pageIndex = -1,
    matchIndex = -1,
  }) {
    super.scrollMatchIntoView({ element, selectedLeft, pageIndex, matchIndex });
    (this._eventBus as IEventBus).dispatch('scrollmatch', {
      source: this,
      element,
      selectedLeft,
      pageIndex,
      matchIndex,
    });
  }

  scrollWordSearchMatchIntoView({
    pageIndex,
    matchIndex,
  }: {
    pageIndex: number;
    matchIndex: number;
  }) {
    if (!this._pageMatches || !this._offset) {
      return;
    }

    // These need to be set to as any due to the PDF.js .d.ts thinking they are always null (this is not the case)
    this._offset.pageIdx = pageIndex as any;
    this._offset.matchIdx = matchIndex as any;
    this._offset.wrapped = false;

    this._highlightMatches = true;

    this._updateMatch(/* found = */ true);
  }

  /**
   * Extracts text content for a single page and stores it in the internal arrays.
   * @param pageIndex - 0-indexed page number
   */
  private async _extractTextForPageIndex(pageIndex: number): Promise<void> {
    if (!this._pdfDocument) {
      throw new Error('No PDF document loaded');
    }

    // Initialize arrays if needed
    if (!this._pageContents) this._pageContents = [];
    if (!this._pageDiffs) this._pageDiffs = [];
    if (!this._hasDiacritics) this._hasDiacritics = [];
    if (!this._pageContentsAsTextLayer) this._pageContentsAsTextLayer = [];

    try {
      const pdfPage = await this._pdfDocument.getPage(pageIndex + 1);
      const textContent: any = await pdfPage.getTextContent();
      const textItems = textContent.items;
      const strBuf: string[] = [];
      const pageContentsAsTextLayerStrBuf: string[] = [];

      for (const textItem of textItems) {
        strBuf.push(textItem.str);
        pageContentsAsTextLayerStrBuf.push(textItem.str);
        if (textItem.hasEOL) {
          strBuf.push('\n');
        }
      }

      this._pageContentsAsTextLayer[pageIndex] = pageContentsAsTextLayerStrBuf;

      [
        this._pageContents[pageIndex],
        this._pageDiffs[pageIndex],
        this._hasDiacritics[pageIndex],
      ] = normalize(strBuf.join(''));
    } catch (reason) {
      console.error(
        `Unable to get text content for page ${pageIndex + 1}`,
        reason
      );
      // Page error -- assuming no text content.
      this._pageContents[pageIndex] = '';
      this._pageDiffs[pageIndex] = null;
      this._hasDiacritics[pageIndex] = false;
    }
  }

  _extractText() {
    if (!this._extractTextPromises) {
      return;
    }

    // Perform text extraction once if this method is called multiple times.
    if (this._extractTextPromises.length > 0) {
      return;
    }

    let promise = Promise.resolve();
    for (let i = 0, ii = this._linkService.pagesCount; i < ii; i++) {
      const extractTextCapability = createPromiseCapability<number>();
      this._extractTextPromises[i] = extractTextCapability.promise;

      promise = promise.then(async () => {
        // Skip if this page was already extracted via warmSearchTextForPage
        if (this._pageContents && this._pageContents[i] !== undefined) {
          extractTextCapability.resolve(i);
          return;
        }

        try {
          await this._extractTextForPageIndex(i);
          extractTextCapability.resolve(i);
        } catch (_error) {
          extractTextCapability.resolve(i);
        }
      });
    }
  }

  /**
   * Force a full text extraction for all pages.
   * This clears the _extractTextPromises array and re-runs extraction.
   * Useful after warmSearchTextForPage to ensure all pages are available for future searches.
   */
  forceFullExtraction() {
    if (!this._extractTextPromises) {
      return;
    }

    // Clear the promises array so _extractText() will run
    this._extractTextPromises = [];

    // Clear page contents that were set to empty strings by warmSearchTextForPage
    // This ensures _extractText() will actually extract them instead of skipping
    if (this._pageContents) {
      for (let i = 0; i < this._pageContents.length; i++) {
        if (this._pageContents[i] === '') {
          this._pageContents[i] = undefined as any;
        }
      }
    }

    // Trigger full extraction
    this._extractText();
  }

  /**
   * Extract text for a specific page immediately and prevent full extraction.
   * This populates the _extractTextPromises array so _extractText() won't run.
   * After using this, call forceFullExtraction() to extract remaining pages.
   * @param pageIndex - 0-indexed page number
   * @returns Promise that resolves when text extraction is complete for that page
   */
  async warmSearchTextForPage(pageIndex: number): Promise<number | undefined> {
    if (!this._pdfDocument || !this._extractTextPromises) {
      return undefined;
    }

    // Check if this page is already extracted
    if (this._pageContents && this._pageContents[pageIndex] !== undefined) {
      return pageIndex;
    }

    // Populate _extractTextPromises with resolved promises to prevent _extractText() from running
    // This is the key optimization - we tell the FindController that extraction is "done"
    const pagesCount = this._linkService.pagesCount;
    if (this._extractTextPromises.length === 0) {
      // Initialize arrays
      if (!this._pageContents) this._pageContents = [];
      if (!this._pageDiffs) this._pageDiffs = [];
      if (!this._hasDiacritics) this._hasDiacritics = [];

      for (let i = 0; i < pagesCount; i++) {
        // Mark all pages as "extracted" with empty content
        // The target page will be filled with real content below
        this._extractTextPromises[i] = Promise.resolve(i);
        this._pageContents[i] = '';
        this._pageDiffs[i] = null;
        this._hasDiacritics[i] = false;
      }
    }

    // Extract the target page using the shared extraction method
    await this._extractTextForPageIndex(pageIndex);
    return pageIndex;
  }
}
