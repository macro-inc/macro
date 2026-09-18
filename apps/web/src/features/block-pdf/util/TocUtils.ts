import type Section from '../model/Section';

class TocUtils {
  public static getSection({
    id,
    idToSectionMap,
  }: {
    id: number;
    idToSectionMap: Partial<Record<number, Section>>;
  }): Section {
    const section = idToSectionMap[id];
    if (!section) {
      throw new Error('Failed to find section with ID ' + id);
    }
    return section.clone();
  }

  public static getNearestSection({
    page,
    yPos,
    idToSectionMap,
  }: {
    page: number;
    yPos: number;
    idToSectionMap: Partial<Record<number, Section>>;
  }): Section | null {
    let nearestSection: Section | null = null;

    for (const section of Object.values(idToSectionMap)) {
      if (!section) continue;
      const appearsBefore =
        section.page < page || (section.page === page && section.y < yPos);
      if (!appearsBefore) continue;

      const appearsAfterNearest =
        nearestSection == null ||
        section.page > nearestSection.page ||
        (section.page === nearestSection.page && section.y > nearestSection.y);
      if (appearsAfterNearest) nearestSection = section;
    }

    return nearestSection?.clone() ?? null;
  }
}

export default TocUtils;
