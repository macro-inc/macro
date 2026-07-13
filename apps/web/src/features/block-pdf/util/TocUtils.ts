import Section, { type StringifyableSection } from '../model/Section';
import type TocItem from '../model/TocItem';
import { cleanQuery } from './StringUtils';

// import type { TPageToSectionMap } from '../context/DefaultTableOfContentsState';
type TPageToSectionMap = Partial<{ [yPos: number]: Section }>[];

/**
 * Types
 */

interface IDProps {
  id: number;
}

interface PathProps {
  path: number[];
}

interface ItemsProps {
  items: TocItem[];
}

/**
 * Util functions
 */

class TocUtils {
  public static getSection({
    id,
    idToSectionMap,
  }: IDProps & {
    idToSectionMap: Partial<Record<number, Section>>;
  }): Section {
    const section = idToSectionMap[id];
    if (!section) {
      // TODO determine if this error is necessary
      // what is fallback Section value?
      throw new Error('Failed to find section with ID ' + id);
    }
    return section.clone();
  }

  /**
   * Get the nearest Section to the provided page/yPost location
   */
  public static getNearestSection({
    page,
    yPos,
    pageToSectionMap,
  }: {
    page: number;
    yPos: number;
    pageToSectionMap: TPageToSectionMap;
  }): Section | null {
    if (!pageToSectionMap) {
      console.error('Missing pageToSectionMap');
    }

    const mappingForThisPage = pageToSectionMap?.[page];
    if (mappingForThisPage) {
      // If there are sections on this page
      let last: Section | null = null;
      for (const section of Object.values(mappingForThisPage)) {
        // TODO this code relies on this being sorted by key
        // This is not the best assumption...
        if (section?.shouldDisplay({ page, yPos })) {
          last = section;
        }
      }

      if (last) {
        return last;
      }
    }

    let otherPage = page - 1;

    /**
     * TODO: efficiency: could create a "CDF" i.e. store best section at "0" so
     * we don't have to examine previous pages
     */
    while (otherPage > 0) {
      const mapping = pageToSectionMap[otherPage];
      const numSectionsOnOtherPage: number = mapping
        ? Object.keys(mapping).length
        : 0;
      if (numSectionsOnOtherPage) {
        // TODO this assumes order of Object.values, which ~ assumes order of IDs
        const sectionToReturn =
          Object.values(mapping)[numSectionsOnOtherPage - 1]!;

        return sectionToReturn;
      }
      otherPage = otherPage - 1;
    }

    return null;
  }

  /**
   * 1. Filter sections that do not contain the query in the full descriptor
   *    NOTE: Query must be found at the start of a token in the descriptor
   *    The only prefixes that are allowed are 'in', 'un', and 're'
   *
   * 2. Filter out sections with the exact same full title. Keep the first one
   *    that appears in the document.
   *       - the effect is the removal of subsections with the same full title
   *       - the first one that appears in the document will be the parent section
   *
   * 3. Sort by the following criteria:
   *       1) The search query is an exact match on one of the tokens
   *       2) The number of times the section is referenced in the document
   */
  public static searchSections(
    query: string,
    sections: StringifyableSection[]
  ): number[] {
    const escapedQuery = cleanQuery(query);
    let includeRE = new RegExp(`(^| | in| un| re| co|-)${escapedQuery}`);
    let sortRE = new RegExp(`(^| )${escapedQuery}( |$|:)`);
    let arr = sections.filter((section) => {
      return includeRE.test(section.lowerCaseFullDescriptor);
    });

    const isExactMatchSomewhere: Record<number, boolean> = {};
    const sectionsWithTitle: { [title: string]: StringifyableSection } = {};
    arr.forEach((section) => {
      let currentSection = sectionsWithTitle[section.fullTitle];
      if (currentSection) {
        if (Section.appearsBefore(section, currentSection)) {
          sectionsWithTitle[section.fullTitle] = section;
        }
      } else {
        sectionsWithTitle[section.fullTitle] = section;
      }
      isExactMatchSomewhere[section.id] = sortRE.test(
        section.lowerCaseFullDescriptor
      );
    });

    return Object.values(sectionsWithTitle)
      .sort((s1, s2) => {
        const s1IsExactMatchSomewhere = isExactMatchSomewhere[s1.id];
        const s2IsExactMatchSomewhere = isExactMatchSomewhere[s2.id];
        if (s1IsExactMatchSomewhere === s2IsExactMatchSomewhere) {
          return s2.numRefs - s1.numRefs;
        } else {
          return (
            Number(s2IsExactMatchSomewhere) - Number(s1IsExactMatchSomewhere)
          );
        }
      })
      .map((s) => s.id);
  }

  private static getPathToTocItemRecursive({
    items,
    id,
    path,
  }: ItemsProps & IDProps & PathProps): number[] | null {
    for (let i = 0; i < items.length; i++) {
      const tocItem = items[i];
      if (tocItem.section.id === id) {
        // This is a match
        return [...path, i];
      }

      // Recursive call on children
      const children = tocItem.children;
      const childTocItem = this.getPathToTocItemRecursive({
        items: children,
        id,
        path: [...path, i],
      });
      if (childTocItem) {
        // If we found the child, return early
        return childTocItem;
      }

      // Else, keep looking
    }

    return null;
  }

  /**
   * TODO this is inefficient...can we cache this?
   *
   * Probably would want to cache upstream (where this is called)
   */
  public static getPathToTocItem(props: ItemsProps & IDProps): number[] | null {
    return TocUtils.getPathToTocItemRecursive({
      ...props,
      path: [],
    });
  }

  public static getTocItemFromPath({
    items,
    path,
  }: ItemsProps & PathProps): TocItem {
    if (!path.length) console.error('Path must be at least of length 1');

    const item = items[path[0]];
    if (!item) {
      console.error('Invalid path');
    }

    if (path.length === 1) {
      return item;
    }

    return this.getTocItemFromPath({
      items: item.children,
      path: path.slice(1),
    });
  }

  public static getTocItemParentFromPath({
    items,
    path,
  }: ItemsProps & PathProps) {
    // Parent path is child path without the last element
    const parentPath = path.slice(0, path.length - 1);
    return this.getTocItemFromPath({ path: parentPath, items });
  }

  /**
   * Returns if the ToC item at the specified path can be left indented
   *
   * You cannot left indent an item that is already at the root of the tree
   */
  public static canLeftIndent(props: PathProps): boolean {
    return props.path.length > 1;
  }

  /**
   * Returns if the ToC item at the specified path can be right indented
   *
   * You cannot right indent an item that is the first of its siblings
   */
  public static canRightIndent({ path }: PathProps): boolean {
    const idx = path[path.length - 1];
    return idx !== 0;
  }
}

export default TocUtils;
