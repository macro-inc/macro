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

      promise = promise.then(() => {
        if (!this._pdfDocument) {
          return;
        }
        return this._pdfDocument
          .getPage(i + 1)
          .then((pdfPage) => {
            return pdfPage.getTextContent();
          })
          .then(
            (textContent: any) => {
              const textItems = textContent.items;
              const strBuf: string[] = [];

              if (!this._pageContentsAsTextLayer) {
                this._pageContentsAsTextLayer = [];
              }

              const pageContentsAsTextLayerStrBuf: string[] = [];

              // Initialize _pageContentsAsTextLayer if needed
              if (!this._pageContentsAsTextLayer) {
                this._pageContentsAsTextLayer = [];
              }

              for (const textItem of textItems) {
                strBuf.push(textItem.str);
                pageContentsAsTextLayerStrBuf.push(textItem.str);
                if (textItem.hasEOL) {
                  strBuf.push('\n');
                }
              }

              this._pageContentsAsTextLayer[i] = pageContentsAsTextLayerStrBuf;

              // Store the normalized page content (text items) as one string.
              [
                this._pageContents![i],
                this._pageDiffs![i],
                this._hasDiacritics![i],
              ] = normalize(strBuf.join(''));
              extractTextCapability.resolve(i);
            },
            (reason) => {
              console.error(
                `Unable to get text content for page ${i + 1}`,
                reason
              );
              // Page error -- assuming no text content.
              this._pageContents![i] = '';
              this._pageDiffs![i] = null;
              this._hasDiacritics![i] = false;
              extractTextCapability.resolve(i);
            }
          );
      });
    }
  }
}
