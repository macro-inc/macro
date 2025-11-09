export const walkBackward = ({
  startPos,
  pageStr,
  desiredWordCount,
}: {
  startPos: number;
  pageStr: string;
  desiredWordCount: number;
}): string => {
  let words = '';
  let currStartPos = startPos - 1;
  let lastCharSpace = false;
  let wordCount = 0;
  while (currStartPos >= 0) {
    const currEntry = pageStr[currStartPos];

    if (currEntry === '.' && lastCharSpace) {
      break;
      // period encountered. check if character before was a space and stop here
    }
    if (currEntry === ' ') {
      lastCharSpace = true;
      wordCount++;
    } else {
      lastCharSpace = false;
    }

    if (wordCount === desiredWordCount + 1) {
      break;
    }

    words += currEntry;

    currStartPos--;
  }
  return words.split('').reverse().join('');
};
export const walkForward = ({
  endPos,
  pageStr,
  desiredWordCount,
}: {
  endPos: number;
  pageStr: string;
  desiredWordCount: number;
}): string => {
  let words = '';
  let currStartPos = endPos + 1;
  let wordCount = 0;
  while (currStartPos < pageStr.length) {
    const currEntry = pageStr[currStartPos];

    if (
      currEntry === '.' &&
      (currStartPos + 1 === pageStr.length || pageStr[currStartPos + 1] === ' ')
    ) {
      // End of sentence
      words += currEntry;
      break;
    }
    if (currEntry === ' ') {
      wordCount++;
    }

    if (wordCount === desiredWordCount + 1) {
      break;
    }

    words += currEntry;

    currStartPos++;
  }
  return words;
};

export const generatePhrases = ({
  page,
  startPos,
  endPos,
}: {
  page: string[];
  startPos: number;
  endPos: number;
}): {
  prePhrase: string;
  matchPhrase: string;
  postPhrase: string;
} => {
  let prePhrase: string = '';
  let matchPhrase: string = '';
  let postPhrase: string = '';

  let charTotal = 0;
  let arrayIdx = 0;

  // How many characters to preview before/after the queried term
  const bufferLength = 30;

  while (charTotal <= startPos) {
    const pageStr = page[arrayIdx];

    charTotal += pageStr.length;
    if (charTotal > startPos) {
      // We are in the correct array, now set variables
      const startMatchIdx = charTotal - startPos;
      const endMatchIdx = charTotal - endPos;

      // prePhrase and postPhrase are sometimes outside of page[arrayIdx]
      prePhrase = page[arrayIdx].slice(
        0,
        page[arrayIdx].length - startMatchIdx
      );
      let i = arrayIdx - 1;
      while (prePhrase.length < bufferLength && i >= 0) {
        const append = page[i].length ? page[i] : ' ';
        prePhrase = append + prePhrase;
        i--;
      }
      prePhrase.replace('\n', ' ');
      if (prePhrase.length > bufferLength)
        prePhrase = prePhrase.substring(
          prePhrase.length - bufferLength,
          prePhrase.length
        );
      if (arrayIdx > 0) prePhrase = '...' + prePhrase;

      postPhrase = page[arrayIdx].slice(page[arrayIdx].length - endMatchIdx);
      i = arrayIdx + 1;
      while (postPhrase.length < 20 && i <= page.length - 1) {
        const prepend = page[i].length ? page[i] : ' ';
        postPhrase = postPhrase + prepend;
        i++;
      }
      postPhrase.replace('\n', ' ');
      if (postPhrase.length > bufferLength)
        postPhrase = postPhrase.substring(0, bufferLength + 1);
      if (arrayIdx < page.length - 1) postPhrase = postPhrase + '...';

      matchPhrase = page[arrayIdx].slice(
        pageStr.length - startMatchIdx,
        pageStr.length - endMatchIdx
      );
      break;
    }
    arrayIdx++;
  }

  return { prePhrase, matchPhrase, postPhrase };
};
