/**
 * @vitest-environment jsdom
 */
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type Section from '../model/Section';
import type { ICoParse } from '../type/coParse';
import TocUtils from '../util/TocUtils';
import { createPdfOutline, type PdfOutline } from './pdf-outline';

function setup(): { outline: PdfOutline; dispose: () => void } {
  return createRoot((dispose) => ({
    outline: createPdfOutline(),
    dispose,
  }));
}

function coparse(toc: string) {
  return { toc } as ICoParse;
}

function sectionMapSnapshot(map: Partial<Record<number, Section>>) {
  return Object.values(map)
    .filter((section): section is Section => section != null)
    .map((section) => ({
      id: section.id,
      page: section.page,
      y: section.y,
      title: section.title,
    }));
}

const firstToc = `
  <document>
    <section
      id="10"
      title="Root section"
      literal="1"
      page="0"
      y="12.5"
      qualified="1 Root section"
      show="true"
      type="SECTION"
    >
      <section
        id="11"
        title="Nested section"
        literal="1.1"
        page="1"
        y="33.25"
        qualified="1.1 Nested section"
        show="true"
        type="SECTION"
      >
        <reference />
      </section>
    </section>
  </document>
`;

const replacementToc = `
  <document>
    <section
      id="20"
      title="Replacement section"
      literal="2"
      page="2"
      y="48.75"
      qualified="2 Replacement section"
      show="true"
      type="SECTION"
    />
  </document>
`;

describe('createPdfOutline', () => {
  it('loads the section-reference map', () => {
    const { outline, dispose } = setup();

    expect(outline.sectionReferenceMap()).toEqual({});

    outline.commands.loadCoparse(coparse(firstToc));

    expect(sectionMapSnapshot(outline.sectionReferenceMap())).toEqual([
      {
        id: 10,
        page: 0,
        y: 12.5,
        title: 'Root section',
      },
      {
        id: 11,
        page: 1,
        y: 33.25,
        title: 'Nested section',
      },
    ]);

    const rootSection = outline.sectionReferenceMap()[10]!;
    expect({
      id: rootSection.id,
      title: rootSection.title,
      literal: rootSection.literal,
      page: rootSection.page,
      y: rootSection.y,
      qualified: rootSection.qualified,
      type: rootSection.type,
      fullTitle: rootSection.fullTitle,
      numRefs: rootSection.numRefs,
      showBookmark: rootSection.showBookmark,
      bookmarkTitle: rootSection.bookmarkTitle,
    }).toEqual({
      id: 10,
      title: 'Root section',
      literal: '1',
      page: 0,
      y: 12.5,
      qualified: '1 Root section',
      type: 'SECTION',
      fullTitle: 'Root section',
      numRefs: 1,
      showBookmark: true,
      bookmarkTitle: ' 1 Root section: Root Section',
    });

    expect(
      TocUtils.getNearestSection({
        page: 1,
        yPos: 30,
        idToSectionMap: outline.sectionReferenceMap(),
      })?.id
    ).toBe(10);
    expect(
      TocUtils.getNearestSection({
        page: 1,
        yPos: 34,
        idToSectionMap: outline.sectionReferenceMap(),
      })?.id
    ).toBe(11);
    expect(
      TocUtils.getNearestSection({
        page: 0,
        yPos: 10,
        idToSectionMap: outline.sectionReferenceMap(),
      })
    ).toBeNull();
    dispose();
  });

  it('replaces stale AI section IDs and isolates outline instances', () => {
    const first = setup();
    const second = setup();

    first.outline.commands.loadCoparse(coparse(firstToc));
    first.outline.commands.loadCoparse(coparse(replacementToc));

    expect(sectionMapSnapshot(first.outline.sectionReferenceMap())).toEqual([
      {
        id: 20,
        page: 2,
        y: 48.75,
        title: 'Replacement section',
      },
    ]);
    expect(second.outline.sectionReferenceMap()).toEqual({});

    first.dispose();
    second.dispose();
  });
});
