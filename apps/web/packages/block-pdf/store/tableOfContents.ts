import { createBlockStore } from '@core/block';
import { produce } from 'solid-js/store';
import Section from '../model/Section';
import TocItem from '../model/TocItem';
import type { IBookmark } from '../type/Bookmark';
import type { ICoParse } from '../type/coParse';
import * as ArrayUtils from '../util/arrayUtils';
import { InvalidActionError } from '../util/errors';
import TocUtils from '../util/TocUtils';
import { XMLUtils } from '../util/XMLUtils';

// import {
//   ITableOfContentsContext,
//   TPageToSectionMap,
//   getDefaultWidth,
// } from './DefaultTableOfContentsState';
const DEFAULT_WIDTH_PX = 150;
export type TPageToSectionMap = Partial<{ [yPos: number]: Section }>[];
interface ITableOfContentsContext {
  // original copies of each TOC mode; allows for quickly swapping between the two
  original: {
    aiToc: TocItem[] | null;
    pdfBookmarks: TocItem[] | null;
  };
  currentMode: 'ai-toc' | 'bookmarks';
  width: number;

  sectionToRenameID: number | null;
  renameFormValue: string;
  sectionToDeleteID: number | null;

  unsavedBookmarks: boolean;
  coparse: ICoParse | null;

  // this is the current table of contents that is displayed, will be swapped out
  // with either object in `original` when swapping between bookmarks and AI TOC
  items: TocItem[];
  openItems: Partial<Record<number, boolean>>;
  isLoaded: boolean;
  pageToSectionMap: TPageToSectionMap;
  idToSectionMap: Partial<{ [sectionId: number]: Section }>;
  idToPathMap: Partial<Record<number, number[]>>;
  idToNearestTitleMap: Partial<{ [sectionId: number]: string | null }>;
  // use this instead of `idToSectionMap` when `currentMode` is `bookmarks`,
  // used for clicking on section references within the document
  aiTocIdToSectionMap: Partial<{ [sectionId: number]: Section }>;
}
function getDefaultWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH_PX;
  return Math.max(DEFAULT_WIDTH_PX, Math.round(window.innerWidth * 0.15));
}
const defaultState: ITableOfContentsContext = {
  original: {
    aiToc: null,
    pdfBookmarks: null,
  },
  currentMode: 'bookmarks',
  width: getDefaultWidth(),

  isLoaded: false,
  sectionToDeleteID: null,
  renameFormValue: '',
  sectionToRenameID: null,
  items: [],
  pageToSectionMap: [],
  unsavedBookmarks: false,
  coparse: null,

  idToSectionMap: {},
  idToPathMap: {},
  idToNearestTitleMap: {},
  openItems: {},
  aiTocIdToSectionMap: {},
};

// From: packages/app/src/context/TableOfContentsContext.ts
/* -------------------------------------------------------------------------- *
 * Types
 * -------------------------------------------------------------------------- */

type LoadAiTocAction = {
  type: 'LOAD_AI_TOC';
  coparse: ICoParse;
};

type LoadPdfBookmarksAction = {
  type: 'LOAD_PDF_BOOKMARKS';
  bookmarks: TocItem[];
};

type SwitchTypeAction = {
  type: 'SWITCH_CURRENT_MODE';
};

type SetTableOfContentsWidth = {
  type: 'SET_TABLE_OF_CONTENTS_WIDTH';
  width: number;
};

type ToggleBookmarkAction = {
  type: 'TOGGLE_BOOKMARK';
  secID: number;
};

type AddBookmarkAction = {
  type: 'ADD_BOOKMARK';
  yPos: number;
  pageNum: number;
  initialEmpty?: boolean; // for placeable bookmarks, start out without title and immediately prompt user to input a title
  titleForPlaceable?: string; // for moving placeable bookmarks (delete then add a new one), create a bookmark with a passed-in title, not based on window selection
  uuid?: string;
};

type DeleteBookmarkAction = {
  type: 'DELETE_BOOKMARK';
  secID: number;
};

type RenameBookmarkAction = {
  type: 'RENAME_BOOKMARK';
  secID: number;
  value: string;
};

type HideRenameBookmarkAction = {
  type: 'HIDE_RENAME_BOOKMARK';
};

type LeftIndentSectionAction = {
  type: 'LEFT_INDENT_SECTION';
  secID: number;
};

type RightIndentSectionAction = {
  type: 'RIGHT_INDENT_SECTION';
  secID: number;
};

type ResetOpenItemsAction = {
  type: 'RESET_OPEN_ITEMS';
};

/**
 * Union type for all actions
 */

type ITableOfContentsAction =
  | RenameBookmarkAction
  | HideRenameBookmarkAction
  | DeleteBookmarkAction
  | ToggleBookmarkAction
  | LoadAiTocAction
  | LoadPdfBookmarksAction
  | SwitchTypeAction
  | LeftIndentSectionAction
  | RightIndentSectionAction
  | AddBookmarkAction
  | SetTableOfContentsWidth
  | ResetOpenItemsAction;

/* -------------------------------------------------------------------------- *
 * Helper functions
 * -------------------------------------------------------------------------- */

class Builder {
  // Store pointer to the draft so any calls to functions update mutable state
  private draft: ITableOfContentsContext;

  public constructor(draft: ITableOfContentsContext) {
    this.draft = draft;
  }

  public getSection(id: number): Section | null {
    const section = this.draft.idToSectionMap[id];
    return section?.clone() ?? null;
  }

  public getTocItemBySectionID(id: number) {
    const path = this.draft.idToPathMap[id];
    if (!path) {
      console.error('Section not found');
      return;
    }
    return TocUtils.getTocItemFromPath({ items: this.draft.items, path });
  }

  public deleteSection(secID: number): void {
    const path = this.draft.idToPathMap[secID];

    if (!path) {
      console.error('Section not found');
      return;
    }

    if (path.length > 1) {
      this.removeSectionFromParent({
        path,
        secID,
      });
    } else {
      // If there are no ancestors, then the section is at the root
      this.draft.items = this.draft.items.filter(
        (item) => item.section.id !== secID
      );
    }

    // Many paths could have changed as a result
    this.computeIDToPathMap();
    this.computePageToSectionMap();
    this.computeIDToSectionMap();
    this.computeIDToNearestTitleMap();

    if (!this.draft.coparse) {
      throw new Error(
        'Coparse datastructure is not defined in table of contents context'
      );
    }

    // TODO: Delete the section and propagate throughout the application (green
    // link in document AND definitions, search results, tab location, etc.)
    // this.idToSection.delete(id)
    Helpers.updateCoParseSectionXML({
      id: secID,
      type: 'DELETE',
      coparse: this.draft.coparse,
    });
  }

  public removeSectionFromParent({
    path,
    secID,
  }: {
    path: number[];
    secID: number;
  }) {
    // If we are removing the node from the root
    if (path.length === 1) {
      this.draft.items = this.draft.items.filter(
        (item) => item.section.id !== secID
      );
      return;
    }

    const parent = TocUtils.getTocItemParentFromPath({
      items: this.draft.items,
      path,
    });

    // Remove section from its former parent
    parent.children = parent.children.filter(
      (child) => child.section.id !== secID
    );
  }

  /**
   * Rename section with ID `id` to have name (title) `name`
   *
   */
  public renameSection(id: number, name: string): this {
    const section = this.getSection(id);
    if (!section) {
      console.error('Section not found');
      return this;
    }

    section.bookmarkTitle = name;
    this.draft.idToSectionMap[id] = section;

    const tocItem = this.getTocItemBySectionID(id);
    if (!tocItem) {
      throw Error(`Failed to find TOC item for section id "${id}"`);
    }

    if (!this.draft.coparse) {
      throw Error(`No coparse data structure in TOC context`);
    }

    tocItem.section = section;
    Helpers.updateCoParseSectionXML({
      id,
      type: 'RENAME',
      bookmarkTitle: name,
      coparse: this.draft.coparse,
    });

    this.computeIDToNearestTitleMap();
    this.computePageToSectionMap();
    this.computeIDToSectionMap();
    this.computeIDToPathMap();

    return this;
  }

  /**
   * Add reference to next and prev section for each section
   */
  addLinksBetweenSections(): this {
    let prevItem: TocItem | null = null;

    function handle(items: TocItem[]) {
      items.forEach((item) => {
        const { section } = item;
        if (prevItem) {
          const prevSection = prevItem.section;
          prevSection.nextSection = section;
          section.prevSection = section;
        }
        prevItem = item;
        if (item.children.length) {
          handle(item.children);
        }
      });
    }

    handle(this.draft.items);

    return this;
  }

  /**
   * Creates mapping from section ID's to Section objects
   *
   * Stores it to the draft
   */
  public computeIDToSectionMap(settingOriginalAiToc?: boolean): this {
    const mapping = Helpers.computeIDToSectionMapRecursive(
      {},
      this.draft.items
    );
    this.draft.idToSectionMap = mapping;
    if (settingOriginalAiToc) {
      const aiTocMapping = Helpers.computeIDToSectionMapRecursive(
        {},
        this.draft.original.aiToc || []
      );
      this.draft.aiTocIdToSectionMap = aiTocMapping;
    }
    return this;
  }

  /**
   * Create mapping from section IDs to paths to reach the section
   *
   * A path is the indices one needs to traverse in the tree to reach a node
   *
   * For example, if we have the tree:
   *
   * ```
   * > A
   * > B
   *   > C
   *     > D
   * > E
   * ```
   *
   * The path to section D is `[1, 0, 0]` to go from B -> C -> D
   */
  public computeIDToPathMap(): this {
    this.draft.idToPathMap = Helpers.computeIDToPathMapRecursive(
      {},
      this.draft.items,
      []
    );
    return this;
  }

  public computeIDToNearestTitleMap(): this {
    this.draft.idToNearestTitleMap =
      Helpers.computeIDToNearestTitleMapRecursive({}, this.draft.items, null);
    return this;
  }

  // If we have one top level section, expand that by default
  public setDefaultOpenState(): this {
    if (this.draft.items.length === 1) {
      const open: Record<number, boolean> = {};
      open[this.draft.items[0].section.id] = true;
      this.draft.openItems = open;
    }
    return this;
  }

  /**
   * Page number -> section ID -> section object
   *
   * TODO could add segment from prev page at yPos 0 for the next page as an
   * optimizations
   */
  computePageToSectionMap(): this {
    this.draft.pageToSectionMap = Helpers.getPageToSectionMapRecursive(
      this.draft.items,
      []
    );
    return this;
  }
}

class Helpers {
  /**
   * Parse out node ID (a number) from an Element
   *
   * Returns null if fails to parse a number
   */
  static getNodeID(node: Element): number | null {
    const nodeIDRaw = node.getAttribute('id');
    if (typeof nodeIDRaw === 'number') {
      return nodeIDRaw;
    }
    if (nodeIDRaw == null) {
      return null;
    }
    const nodeID = parseInt(nodeIDRaw, 10);
    if (isNaN(nodeID)) {
      return null;
    }

    return nodeID;
  }

  /**
   * TODO this is inefficient
   */
  static findNodeByID(secID: number, node: Element): Element | null {
    if (this.getNodeID(node) === secID) {
      return node;
    }

    // Cast to an array so we can use array functions like `filter`
    const children = Array.from(node.children).filter(
      (child) => child.tagName === 'section'
    );

    for (const childNode of children) {
      // Recursive call
      const match = Helpers.findNodeByID(secID, childNode);

      if (match) {
        return match;
      }
    }

    return null;
  }

  /**
   * Convert section to node element
   *
   * Example HTML/XML:
   * <section
   *   title='Permitted Encumbrances '
   *   literal='1.04'
   *   page='15'
   *   y='70.994865'
   *   id='14'
   *   qualified='1.04'
   *   show='true'
   *   type='SECTION'
   * ></section>
   */
  static sectionToNodeElement(section: Section): HTMLElement {
    const sectionNode = document.createElement('section');
    sectionNode.setAttribute('title', section.title);
    sectionNode.setAttribute('literal', section.literal ?? '');
    sectionNode.setAttribute('page', section.page + '');
    sectionNode.setAttribute('y', section.y + '');
    sectionNode.setAttribute('id', section.id + '');
    sectionNode.setAttribute('qualified', section.qualified);
    sectionNode.setAttribute('show', section.showBookmark + '');
    sectionNode.setAttribute('type', section.type ?? '');

    return sectionNode;
  }

  static updateCoParseSectionXML(
    props: { coparse: ICoParse } & (
      | {
          type: 'RENAME';
          id: number;
          bookmarkTitle: string;
        }
      | {
          type: 'DELETE';
          id: number;
        }
      | {
          type: 'RIGHT_INDENT';
          id: number;
          parentID: number;
        }
      | {
          type: 'LEFT_INDENT';
          id: number;
          parentID: number | null;
          newChildrenIDs: number[];
        }
      | {
          type: 'INSERT';
          parentSectionID: number | null;
          insertAtIndex: number | null;
          section: Section;
        }
    )
  ): ICoParse {
    const coparse = Object.assign({}, props.coparse);
    const sectionXML = coparse.toc ?? '';
    const htmlDom = XMLUtils.parse(sectionXML);
    const { firstChild } = htmlDom;
    if (!firstChild) {
      console.error('Missing firstChild in HTML DOM for Table of Contents');
      return coparse;
    }
    const elt = firstChild as Element;

    if (props.type === 'INSERT') {
      const { section, parentSectionID, insertAtIndex } = props;

      const sectionNode = this.sectionToNodeElement(section);
      const parentNode = parentSectionID
        ? Helpers.findNodeByID(parentSectionID, elt)
        : elt;

      if (!parentNode) {
        console.error('Failed to find parent node for new bookmark');
        return coparse;
      }

      // Second parameter here is the `referenceNode` (which node to insert
      // before). If this is null, this inserts as the last child.
      // https://developer.mozilla.org/en-US/docs/Web/API/Node/insertBefore#syntax
      const refChild: Element | null =
        (insertAtIndex != null && parentNode.children[insertAtIndex]) || null;
      parentNode?.insertBefore(sectionNode, refChild);
    } else {
      const { id } = props;
      const targetNode = Helpers.findNodeByID(id, elt);
      if (!targetNode) {
        console.error('Failed to find target node');
        return coparse;
      }

      if (props.type === 'RIGHT_INDENT') {
        /**
         * This is a simple case compared to left indent, since there is no need
         * for surgery on the children. We just need to find the target node and
         * move it to be a child of its new parent (the ToC item immediately
         * before it in the PDF)
         */
        const parentNode = Helpers.findNodeByID(props.parentID, elt);
        if (!parentNode) {
          console.error('Failed to find parent node');
          return coparse;
        }

        // Move target node to be a child of the new parent
        parentNode.appendChild(targetNode);
      } else if (props.type === 'LEFT_INDENT') {
        /**
         * If no parentID is supplied, that means we are moving the node to be a
         * root ToC item. It's parent is thus elt itself.
         *
         * 1. Move the target node to be a child of the parent
         *
         * 2. Update list of children to have the target node as their new parent
         *    these are the children which used to be siblings of the target node,
         *    but now are children since the target node has shifted left.
         *
         * For example, say we want to left indent C:
         *
         * ```
         * | Before: | After:  |
         * |---------|---------|
         * | > A     | > A     |
         * |   > B   |   > B   |
         * |   > C   | > C     |
         * |   > D   |   > D   |
         * |   > E   |   > E   |
         * ```
         *
         * D and E have moved from being children of A to being children of C.
         */
        const { parentID, newChildrenIDs } = props;
        const parentNode = parentID ? Helpers.findNodeByID(parentID, elt) : elt;

        if (!parentNode) {
          console.error('Failed to find parent node');
          return coparse;
        }

        parentNode.appendChild(targetNode);

        newChildrenIDs.forEach((childID) => {
          const childNode = Helpers.findNodeByID(childID, parentNode);

          if (!childNode) {
            console.error('Failed to find child node');
            return;
          }

          targetNode.appendChild(childNode);
        });
      } else if (props.type === 'DELETE') {
        // NOTE we must set value to a string (even though it's really a boolean)
        targetNode.setAttribute('show', 'false');
      } else if (props.type === 'RENAME') {
        targetNode.setAttribute('bookmark', props.bookmarkTitle);
      }
    }

    coparse.toc = new XMLSerializer().serializeToString(htmlDom);
    return coparse;
  }

  static computeIDToNearestTitleMapRecursive(
    mapping: Partial<Record<number, string>>,
    items: TocItem[],
    nearestParentTitle: string | null
  ): Partial<Record<number, string>> {
    items.forEach((item) => {
      const { id, bookmarkTitle } = item.section;

      // Use `||` insetad of `??` so the empty string counts as no title
      // Use bookmarkTitle here because that's the value that gets edited when renaming
      const nearestTitle = bookmarkTitle || nearestParentTitle || null;
      if (nearestTitle) {
        mapping[id] = nearestTitle;
      }
      return Helpers.computeIDToNearestTitleMapRecursive(
        mapping,
        item.children,
        nearestTitle
      );
    });

    return mapping;
  }

  static computeIDToSectionMapRecursive(
    mapping: Partial<Record<number, Section>>,
    items: TocItem[]
  ): Partial<Record<number, Section>> {
    items.forEach((item) => {
      const section = item.section;
      mapping[section.id] = section;
      const children = item.children;

      if (children.length) {
        Helpers.computeIDToSectionMapRecursive(mapping, children);
      }
    });

    return mapping;
  }

  static computeIDToPathMapRecursive(
    mapping: Partial<Record<number, number[]>>,
    items: TocItem[],
    path: number[]
  ): Partial<Record<number, number[]>> {
    items.forEach((item, idx) => {
      const newPath = [...path, idx];
      const id = item.section.id;
      mapping[id] = newPath;
      const children = item.children;

      Helpers.computeIDToPathMapRecursive(mapping, children, newPath);
    });

    return mapping;
  }

  public static parseItem(
    node: Element,
    bookmark?: IBookmark,
    sections?: Element[]
  ): TocItem {
    const id = node.getAttribute('id') || '';
    const title = node.getAttribute('title') || '';
    const literal = node.getAttribute('literal');
    const page = parseInt(node.getAttribute('page') || '');
    const y = parseFloat(node.getAttribute('y') || '');
    const qualified = node.getAttribute('qualified') || '';
    const numRefs = node.getElementsByTagName('reference').length;
    const type = Section.parseSegmentType(node.getAttribute('type'));
    const fullTitle = Section.getFullTitle(node);

    // If sections is defined and bookmark is not, then bookmarks exist and the
    // selected bookmark was manually removed
    const showBookmark =
      bookmark === undefined && sections !== undefined
        ? false
        : // Either it is not set, in which case we default to showing, or the value is
          // literally set to "true"
          !node.getAttribute('show') || node.getAttribute('show') === 'true';
    const bookmarkTitle = bookmark
      ? bookmark.title
      : node.getAttribute('bookmark');

    const idNum = parseInt(id, 10);

    if (isNaN(idNum)) {
      console.error('Invalid section ID');
    }

    const section = new Section({
      id: idNum,
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
    });

    let children: TocItem[] = [];

    if (bookmark === undefined) {
      const childElems = [...(node?.children ?? [])];
      children = childElems
        .filter((child) => child.tagName === 'section')
        .map((node) => Helpers.parseItem(node));
    } else {
      bookmark.children.forEach((b) => {
        const existingSection = sections?.find(
          (node) => parseInt(node.id) === b.id
        );
        if (existingSection)
          children.push(Helpers.parseItem(existingSection, b, sections));
      });
    }

    return new TocItem(section, children);
  }

  static getPageToSectionMapRecursive(
    items: TocItem[],
    pageToSec: TPageToSectionMap
  ): TPageToSectionMap {
    for (let item of items) {
      const section = item.section;
      const page = section.page;
      const pageMap = pageToSec[page] || {};
      const y = section.y;

      if (typeof y === 'number') {
        pageMap[y] = section;
      } else {
        console.error('Section has invalid y value');
      }

      pageToSec[page] = pageMap;
      Helpers.getPageToSectionMapRecursive(item.children, pageToSec);
    }

    return pageToSec;
  }

  static recursiveFindUuid(uuid: string, tocItem: TocItem) {
    if (tocItem.section.uuid === uuid) {
      return [tocItem.section.id];
    }

    let ancestorIds: number[] = [];
    tocItem.children.forEach((childItem) => {
      const foundChildrenIds = this.recursiveFindUuid(uuid, childItem);
      if (foundChildrenIds.length > 0) {
        ancestorIds = [
          ...ancestorIds,
          ...foundChildrenIds,
          childItem.section.id,
        ];
      }
    });

    return ancestorIds;
  }

  /**
   * Find a given section based on UUID, then return all of its ancestors (including itself)
   */
  static findAllAncestors(uuid: string, tocItems: TocItem[]) {
    let ancestorIds: number[] = [];

    tocItems.forEach((item) => {
      const foundChildrenIds = this.recursiveFindUuid(uuid, item);
      if (foundChildrenIds.length > 0) {
        ancestorIds = [...ancestorIds, ...foundChildrenIds, item.section.id];
      }
    });

    return ancestorIds;
  }

  static flattenAllSections(tocItem: TocItem): Section[] {
    let sections: Section[] = [tocItem.section];

    if (tocItem.children.length > 0) {
      tocItem.children.forEach((childItem) => {
        sections = [...sections, ...this.flattenAllSections(childItem)];
      });
    } else {
      sections.push(tocItem.section);
    }

    return sections;
  }

  static sectionToNodeElementRecursive(tocItem: TocItem): string {
    // HTMLElement -> string (in XML format)
    const currentSectionXml = new XMLSerializer().serializeToString(
      this.sectionToNodeElement(tocItem.section)
    );
    let xmlElements: string[] = [
      // remove end tag so that all child elements can be nested
      // within, then re-add end tag afterwards
      currentSectionXml.split('</section>')[0],
    ];

    tocItem.children.forEach((childItem) => {
      const childElements = this.sectionToNodeElementRecursive(childItem);
      xmlElements = [...xmlElements, ...childElements];
    });

    return xmlElements.join('') + '</section>';
  }

  static tocItemsToXml(tocItems: TocItem[]): string {
    let xmlElements: string[] = [];
    tocItems.forEach((tocItem) => {
      xmlElements = [
        ...xmlElements,
        this.sectionToNodeElementRecursive(tocItem),
      ];
    });

    return `<xml>${xmlElements.join('')}</xml>`;
  }

  static addItemToSectionChildren({
    parentSectionId,
    insertItem,
    existingItem,
  }: {
    parentSectionId: number;
    insertItem: TocItem;
    existingItem: TocItem;
  }) {
    let children: TocItem[] = [];

    if (existingItem.section.id === parentSectionId) {
      children =
        existingItem.children.length === 0
          ? [insertItem]
          : [insertItem, ...existingItem.children];
    } else {
      existingItem.children.forEach((childItem) => {
        children.push(
          this.addItemToSectionChildren({
            parentSectionId,
            insertItem,
            existingItem: childItem,
          })
        );
      });
    }

    existingItem.children = children;
    return existingItem;
  }

  static insertSectionIntoItems({
    section,
    parentSectionId,
    items,
  }: {
    section: Section;
    parentSectionId: number | null;
    items: TocItem[];
  }): TocItem[] {
    let updatedItems: TocItem[] = [];
    const tocItem = new TocItem(section, []);

    if (parentSectionId === null) {
      updatedItems = [tocItem, ...items];
    } else {
      items.forEach((item) => {
        const updatedItem = this.addItemToSectionChildren({
          parentSectionId,
          insertItem: tocItem,
          existingItem: item,
        });
        updatedItems = [...updatedItems, updatedItem];
      });
    }

    return updatedItems;
  }

  static recursiveCloneTocItem(tocItem: TocItem): TocItem {
    return tocItem.clone(
      tocItem.children.map((childItem) => this.recursiveCloneTocItem(childItem))
    );
  }

  static cloneTocTree(tree: TocItem[]): TocItem[] {
    return tree.map((treeItem) => this.recursiveCloneTocItem(treeItem));
  }
}

/* -------------------------------------------------------------------------- *
 * Reducer
 * -------------------------------------------------------------------------- */

const producer = (
  draft: ITableOfContentsContext,
  action: ITableOfContentsAction
) => {
  switch (action.type) {
    case 'LOAD_AI_TOC': {
      const firstChild = XMLUtils.parse(action.coparse.toc || '').firstChild as
        | Element
        | undefined;
      const children: TocItem[] = [...(firstChild?.children ?? [])]
        .filter((child) => child.tagName === 'section')
        .map((node) => Helpers.parseItem(node, undefined));

      // In case `window` was undefined when we created the default state
      draft.width = getDefaultWidth();
      draft.pageToSectionMap = [];
      draft.original.aiToc = [...children];

      // include everything from action.coparse except for toc because PDF
      // bookmarks on page load, so LOAD_PDF_BOOKMARKS sets the value for toc
      const existingCoParseToc = draft.coparse?.toc;
      draft.coparse = action.coparse;
      draft.coparse.toc = existingCoParseToc;

      new Builder(draft)
        .computePageToSectionMap()
        .computeIDToSectionMap(true)
        .computeIDToPathMap()
        .addLinksBetweenSections()
        .computeIDToNearestTitleMap(); // TODO call this in more places

      draft.isLoaded = !!draft.original.aiToc && !!draft.original.pdfBookmarks;
      break;
    }
    case 'LOAD_PDF_BOOKMARKS': {
      draft.original.pdfBookmarks = action.bookmarks;
      draft.items = Helpers.cloneTocTree(action.bookmarks);
      draft.isLoaded = !!draft.original.aiToc && !!draft.original.pdfBookmarks;

      const coparse = Object.assign({}, draft.coparse);
      coparse.toc = Helpers.tocItemsToXml(action.bookmarks);
      draft.coparse = coparse;

      new Builder(draft)
        .computePageToSectionMap()
        .computeIDToSectionMap()
        .computeIDToPathMap()
        .addLinksBetweenSections()
        .computeIDToNearestTitleMap()
        .setDefaultOpenState();

      break;
    }
    case 'SWITCH_CURRENT_MODE': {
      const { currentMode, original } = draft;
      const originalBookmarks = original.pdfBookmarks;
      const originalToc = original.aiToc;

      if (originalBookmarks === null || originalToc === null) {
        break;
      }

      if (currentMode === 'ai-toc') {
        draft.currentMode = 'bookmarks';
        draft.items = Helpers.cloneTocTree(originalBookmarks);
        const coparse = Object.assign({}, draft.coparse);
        coparse.toc = Helpers.tocItemsToXml(originalBookmarks);
        draft.coparse = coparse;
        draft.openItems =
          originalBookmarks.length === 1
            ? { [originalBookmarks[0].section.id]: true }
            : {};
      } else if (currentMode === 'bookmarks') {
        draft.currentMode = 'ai-toc';
        draft.items = Helpers.cloneTocTree(originalToc);
        const coparse = Object.assign({}, draft.coparse);
        coparse.toc = Helpers.tocItemsToXml(originalToc);
        draft.coparse = coparse;
        draft.openItems =
          originalToc.length === 1 ? { [originalToc[0].section.id]: true } : {};
      }

      new Builder(draft)
        .computePageToSectionMap()
        .computeIDToSectionMap()
        .computeIDToPathMap()
        .addLinksBetweenSections()
        .computeIDToNearestTitleMap();

      break;
    }
    case 'SET_TABLE_OF_CONTENTS_WIDTH': {
      if (action.width <= 0) {
        console.error('Table of contents width must be positive');
        return;
      }

      if (action.width > window.innerWidth) {
        console.error('Table of contents cannot be wider than the window');
        return;
      }

      draft.width = action.width;
      break;
    }
    case 'TOGGLE_BOOKMARK': {
      const { secID } = action;
      draft.openItems[secID] = !draft.openItems[secID];
      break;
    }
    case 'DELETE_BOOKMARK': {
      const { secID } = action;

      if (secID === null) {
        console.error('Invalid state to delete bookmark');
        return;
      }

      new Builder(draft).deleteSection(secID);

      draft.unsavedBookmarks = true;

      // draft.items = newItems;
      draft.sectionToDeleteID = null;
      break;
    }
    case 'LEFT_INDENT_SECTION': {
      const { secID } = action;
      const path = draft.idToPathMap[secID];
      if (!path) {
        console.error('Section not found');
        return;
      }

      if (!TocUtils.canLeftIndent({ path })) {
        console.error('Cannot left indent the section provided');
        return;
      }

      const parent = TocUtils.getTocItemParentFromPath({
        items: draft.items,
        path,
      });

      const siblings = parent.children;
      const idx = path[path.length - 1];
      const item = siblings[idx];

      if (!item) {
        console.error('Failed to find item ');
        return;
      }

      // Update parent children
      parent.children = siblings.slice(0, idx);
      const newChildren = siblings.slice(idx + 1);

      // If not this, then there are no changes to the node's children
      if (newChildren.length) {
        item.children = [...item.children, ...newChildren];
      }

      const newIndex = path[path.length - 2] + 1;

      let newParent: TocItem | null = null;

      if (path.length < 3) {
        // Item will now be at root of tree
        // Inserted right after its parent
        draft.items = ArrayUtils.withItemAtIndex(draft.items, item, newIndex);
      } else {
        newParent = TocUtils.getTocItemFromPath({
          items: draft.items,
          path: path.slice(0, path.length - 2),
        });
        newParent.children = ArrayUtils.withItemAtIndex(
          newParent.children,
          item,
          newIndex
        );
      }

      // Expand the relocated item if it is not already expanded
      draft.openItems[secID] = true;

      new Builder(draft).computeIDToPathMap().computeIDToNearestTitleMap();

      if (!draft.coparse) {
        throw new Error(
          'CoParse data structure is not defined when trying to update section html'
        );
      }

      Helpers.updateCoParseSectionXML({
        type: 'LEFT_INDENT',
        id: secID,
        // TODO or could give parent path for more efficient access
        parentID: newParent?.section.id ?? null,
        newChildrenIDs: newChildren.map((child) => child.section.id),
        coparse: draft.coparse,
      });
      draft.unsavedBookmarks = true;

      break;
    }
    case 'RIGHT_INDENT_SECTION': {
      const { secID } = action;
      const path = draft.idToPathMap[secID];

      if (!path) {
        console.error('Section not found');
        return;
      }
      if (!TocUtils.canRightIndent({ path })) {
        console.error('Cannot right indent the section provided');
        return;
      }

      // Append the child to the new parent
      // It comes last in the list of children (top to bottom order maintained)
      const item = TocUtils.getTocItemFromPath({ items: draft.items, path });

      new Builder(draft).removeSectionFromParent({
        path,
        secID,
      });

      // New parent is the sibling directly above it
      const newParentPath = (() => {
        const newPath = path.slice(0, path.length - 1);
        newPath.push(path[path.length - 1] - 1);
        return newPath;
      })();
      const newParent = TocUtils.getTocItemFromPath({
        items: draft.items,
        path: newParentPath,
      });
      newParent.children.push(item);

      // Expand the new parent to show where the node went
      draft.openItems[newParent.section.id] = true;

      if (!draft.coparse) {
        throw new Error('CoParse data structure is not defined');
      }

      Helpers.updateCoParseSectionXML({
        type: 'RIGHT_INDENT',
        id: secID,
        // TODO or could give parent path for more efficient access
        parentID: newParent.section.id,
        coparse: draft.coparse,
      });

      draft.unsavedBookmarks = true;

      new Builder(draft).computeIDToPathMap().computeIDToNearestTitleMap();

      break;
    }
    case 'RENAME_BOOKMARK': {
      const { secID, value } = action;

      if (!value) {
        console.error('Missing value');
        return;
      }

      new Builder(draft).renameSection(secID, value);

      draft.unsavedBookmarks = true;

      draft.renameFormValue = '';
      draft.sectionToRenameID = null;
      break;
    }
    case 'ADD_BOOKMARK': {
      const { yPos, pageNum, initialEmpty, titleForPlaceable, uuid } = action;
      const selection = window.getSelection();
      const text =
        titleForPlaceable || (selection ? selection.toString().trim() : null);

      if (!text && !initialEmpty) {
        console.error('You must select text to add a bookmark');
        return;
      }

      if (pageNum < 0) {
        console.error('Invalid page for bookmark');
        return;
      }

      if (yPos < 0) {
        console.error('Invalid Y position for bookmark');
        return;
      }

      const title = text || '';

      const section = new Section({
        id: Math.floor(Math.random() * 10 ** 10), // TODO replace this with uuid when section IDs are no longer numbers
        title,
        page: pageNum,
        y: yPos,
        showBookmark: true,
        fullTitle: title,
        literal: null,
        qualified: '',
        numRefs: 0,
        bookmarkTitle: title,
        type: 'SECTION',
        uuid, // pass in UUID if recreating an existing bookmark, otherwise section constructor will generate a UUID
      });

      // flattened list of all bookmark sections in document
      let allSections: Section[] = [];
      draft.items.forEach((sectionItem) => {
        allSections = [
          ...allSections,
          ...Helpers.flattenAllSections(sectionItem),
        ];
      });

      // find the closest section before the new bookmark's position
      let nearestSection: Section | null = null;
      allSections.forEach((sectionItem: Section) => {
        if (
          sectionItem.page < section.page ||
          (sectionItem.page === section.page && sectionItem.y <= section.y)
        ) {
          nearestSection = sectionItem;
        }
      });
      nearestSection = nearestSection as Section | null;

      if (!draft.coparse) {
        throw new Error('CoParse data structure is not defined');
      }

      // add new section to items
      draft.items = Helpers.insertSectionIntoItems({
        section,
        parentSectionId: nearestSection?.id ?? null,
        items: draft.items,
      });

      // add new section to XML
      draft.coparse = Helpers.updateCoParseSectionXML({
        section,
        type: 'INSERT',
        parentSectionID: nearestSection?.id ?? null,
        insertAtIndex: 0,
        coparse: draft.coparse,
      });

      // open all ancestors of new section in outline
      const ancestors = Helpers.findAllAncestors(section.uuid, draft.items);
      if (ancestors.length > 0) {
        [...ancestors, ...(nearestSection ? [nearestSection.id] : [])].forEach(
          (sectionId) => {
            draft.openItems[sectionId] = true;
          }
        );
      } else {
        console.error(
          'Error: Newly created outline section could not be found in tree'
        );
      }

      new Builder(draft)
        .computeIDToNearestTitleMap()
        .computePageToSectionMap()
        .computeIDToSectionMap()
        .computeIDToPathMap();

      break;
    }
    case 'RESET_OPEN_ITEMS': {
      draft.openItems = {};
      break;
    }
    default:
      throw new InvalidActionError(action);
  }
};

function recursiveFindByUuid(uuid: string, tocItem: TocItem): Section | null {
  if (tocItem.section.uuid === uuid || tocItem.uuid === uuid) {
    return tocItem.section;
  }

  let foundSection: Section | null = null;
  tocItem.children.forEach((childItem) => {
    const childrenResults = recursiveFindByUuid(uuid, childItem);
    if (childrenResults) {
      foundSection = childrenResults;
    }
  });

  return foundSection;
}

export function findSectionByUuid(
  uuid: string,
  items: TocItem[]
): Section | null {
  let foundSection: Section | null = null;
  items.forEach((childItem) => {
    const childrenResults = recursiveFindByUuid(uuid, childItem);
    if (childrenResults) {
      foundSection = childrenResults;
    }
  });

  return foundSection;
}

// From: packages/app/src/atoms/tableOfContents.tsx
const tableOfContentStore =
  createBlockStore<ITableOfContentsContext>(defaultState);

export function useTableOfContentsValue() {
  const tocStore = tableOfContentStore.get;
  return () => tocStore;
}

export function useTableOfContentsUpdate() {
  const setTocStore = tableOfContentStore.set;
  return (action: ITableOfContentsAction) => {
    // @ts-ignore
    setTocStore(produce((state) => producer(state, action)));
  };
}

export function useGetIdToSectionMap() {
  const tocStore = tableOfContentStore.get;
  return () =>
    tocStore.currentMode === 'bookmarks'
      ? tocStore.aiTocIdToSectionMap
      : tocStore.idToSectionMap;
}

export function useGetPageToSectionMap() {
  const tocStore = tableOfContentStore.get;
  return () => tocStore.pageToSectionMap;
}
