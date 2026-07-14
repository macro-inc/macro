import type Section from './Section';

/**
 * Wrapper on Section to store Table of Contents-related information, namely
 * what sections are under this section and whether the item is expanded
 */
class TocItem {
  public section: Section;
  public children: TocItem[];
  public uuid: string;
  public expanded?: boolean;

  constructor(section: Section, children: TocItem[]) {
    this.section = section;
    this.children = children;
    this.uuid = `${Date.now()}-${section.id}`;
  }

  public clone(children?: TocItem[]): TocItem {
    return new TocItem(this.section, children || this.children);
  }
}

export default TocItem;
