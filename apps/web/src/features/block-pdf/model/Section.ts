import { v7 as uuid7 } from 'uuid';

function decodeHTMLString(strToDecode: string): string {
  const parser = new DOMParser();
  const decodedString = parser.parseFromString(
    `<!doctype html><body>${strToDecode}`,
    'text/html'
  ).body.textContent;
  return decodedString ?? '';
}

type SectionType = 'SECTION' | 'ARTICLE';

export interface ISection {
  id: number;
  title: string;
  literal: string | null;
  page: number;
  y: number;
  qualified: string;
  type: SectionType | null;
  fullTitle: string;
  numRefs: number;
  showBookmark: boolean;
  bookmarkTitle: string | null;
  cloned?: boolean;
  uuid?: string;
}

class Section {
  private static readonly NON_CAP_WORDS = [
    'a',
    'an',
    'the',
    'and',
    'but',
    'or',
    'nor',
    'as',
    'at',
    'by',
    'for',
    'in',
    'of',
    'on',
    'per',
    'to',
    'via',
    'its',
  ];

  /**
   * NOTE section IDs are numbers because this allows us to order them and
   * assign a hierarchy to them
   */
  public readonly id: number;
  public title: string;
  public titleCased: string;
  public literal: string | null;
  public page: number;
  public y: number;
  public qualified: string;
  public type: SectionType | null;
  public typeCased: string;
  public fullTitle: string;
  public numRefs: number;
  public uuid: string;
  public fullDescriptor: string;
  public lowerCaseFullDescriptor: string;
  public showBookmark: boolean;
  public bookmarkTitle: string | null;
  public cloned: boolean = false;

  constructor({
    id,
    title,
    literal,
    page,
    y,
    qualified,
    type,
    fullTitle,
    numRefs,
    showBookmark = true,
    bookmarkTitle = null,
    cloned = false,
    uuid,
  }: ISection) {
    // Provided props
    this.id = id;
    this.title = cloned ? title : decodeHTMLString(title);
    this.titleCased = cloned ? title : Section.toTitleCase(this.title);
    this.literal = literal;
    this.page = page;
    this.y = y;
    this.qualified = qualified;
    this.type = type;
    this.numRefs = numRefs;
    this.showBookmark = showBookmark;

    // Derived props
    this.typeCased = cloned
      ? (type ?? '')
      : Section.toTitleCase(type) !== 'Section'
        ? Section.toTitleCase(type)
        : '';
    this.fullTitle = cloned ? fullTitle : decodeHTMLString(fullTitle);

    this.uuid = uuid || uuid7();

    this.fullDescriptor = cloned
      ? ''
      : this.qualified
        ? `${Section.toTitleCase(this.type)} ${this.qualified}: ${this.fullTitle}`
        : this.fullTitle;
    this.lowerCaseFullDescriptor = this.fullDescriptor.toLowerCase(); // For efficient searching

    this.bookmarkTitle = cloned
      ? ''
      : bookmarkTitle
        ? decodeHTMLString(bookmarkTitle)
        : this.qualified
          ? `${this.typeCased} ${this.qualified}${
              this.titleCased ? `: ${this.titleCased}` : ''
            }`
          : this.titleCased;
  }

  public static parseSegmentType(
    type: string | null | undefined
  ): SectionType | null {
    if (!type) return null;
    const cleanedType = type.toUpperCase();
    if (cleanedType === 'SECTION') return 'SECTION';
    if (cleanedType === 'ARTICLE') return 'ARTICLE';
    return null;
  }

  static toTitleCase(str: string | null): string {
    if (!str) return '';

    let cleaned = str.trim();
    if (cleaned === cleaned.toUpperCase()) {
      cleaned = cleaned.toLowerCase();
    }

    return cleaned
      .split(' ')
      .map((word, idx, words): string => {
        if (!word) return '';
        if (
          !Section.NON_CAP_WORDS.includes(word) ||
          idx === 0 ||
          words[idx - 1] === '/'
        ) {
          return word[0].toUpperCase() + word.substring(1);
        }

        return word;
      })
      .join(' ');
  }

  /**
   * Returns a clone of the section
   *
   * New object in memory with the same properties
   *
   * Thus, changes to this object will not result in changes to prev object
   */
  public clone(): Section {
    const {
      id,
      title,
      literal,
      page,
      y,
      qualified,
      type,
      fullTitle,
      numRefs,
      showBookmark,
      bookmarkTitle,
    } = this;
    const clone = new Section({
      id,
      title,
      literal,
      page,
      y,
      qualified,
      type,
      fullTitle,
      numRefs,
      showBookmark,
      bookmarkTitle,
      cloned: true,
    });
    clone.titleCased = this.titleCased;
    clone.typeCased = this.typeCased;
    clone.fullTitle = this.fullTitle;
    clone.fullDescriptor = this.fullDescriptor;
    clone.bookmarkTitle = this.bookmarkTitle;

    return clone;
  }

  static getFullTitle(sectionNode: Element): string {
    const title = sectionNode.getAttribute('title');
    const type = sectionNode.getAttribute('type');
    const parentNode = sectionNode.parentElement;

    if (!parentNode) {
      console.error('Missing parent node');
      return '';
    }

    if (parentNode.getAttribute('type') !== type) {
      if (title) {
        return title;
      }

      return parentNode.getAttribute('title') ?? '';
    }

    return this.getFullTitle(parentNode) + (title ? ` / ${title}` : '');
  }
}

export default Section;
