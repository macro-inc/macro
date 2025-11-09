import { v7 as uuid7 } from 'uuid';
import type { PageModel } from './Page';

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
  nextSection?: ISection | null;
  prevSection?: ISection | null;
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
  public nextSection: ISection | null;
  public prevSection: ISection | null;
  public fullDescriptor: string;
  public lowerCaseFullDescriptor: string;
  public showBookmark: boolean;
  public bookmarkTitle: string | null;
  public cloned: boolean = false;

  public pages: PageModel[] | null;

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
    nextSection = null,
    prevSection = null,
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

    this.nextSection = nextSection; // Set after construction if not provided
    this.prevSection = prevSection; // Set after construction if not provided

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

    this.pages = null;
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
      nextSection,
      prevSection,
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
      nextSection,
      prevSection,
      cloned: true,
    });
    clone.titleCased = this.titleCased;
    clone.typeCased = this.typeCased;
    clone.fullTitle = this.fullTitle;
    clone.fullDescriptor = this.fullDescriptor;
    clone.bookmarkTitle = this.bookmarkTitle;

    return clone;
  }

  public static appearsBefore(
    section: Pick<Section, 'page' | 'y'>,
    otherSection: Pick<Section, 'page' | 'y'>
  ) {
    return (
      section.page < otherSection.page ||
      (section.page === otherSection.page && section.y < otherSection.y)
    );
  }

  public shouldDisplay({
    page,
    yPos,
  }: {
    page: number;
    yPos: number;
  }): boolean {
    const bufferedY = yPos;
    const { page: nextPage, y: nextY } = this.nextSection ?? {};

    // Should not display if section is on a later page
    if (this.page > page) {
      return false;
    }

    if (page === this.page) {
      // On same page as section
      if (bufferedY > this.y) {
        // Currently below section title
        if (nextPage === page && nextY != null) {
          // Next section is on same page
          // Return true if next section is below the current y-position
          return bufferedY < nextY;
        } else {
          return true;
        }
      }

      return false;
    }

    // On page after section
    // If this is the last section
    if (nextPage == null || nextY == null) {
      // Last section
      return true;
    } else if (page < nextPage) {
      // Current page between this section and next section
      return true;
    } else if (nextPage === page) {
      // Next section is on current page
      // return yPos + buffer < this.nextY
      return bufferedY < nextY;
    }

    return false;
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

/**
 * Stringifyable version of a Section object
 *
 * Specifically, this is used for searching sections
 */
export type StringifyableSection = Pick<
  Section,
  'lowerCaseFullDescriptor' | 'id' | 'numRefs' | 'fullTitle' | 'page' | 'y'
>;
