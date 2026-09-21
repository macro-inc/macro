import { createSignal } from 'solid-js';
import Section from '../model/Section';
import type { ICoParse } from '../type/coParse';
import { XMLUtils } from '../util/XMLUtils';

function addSectionReference(
  node: Element,
  mapping: Partial<Record<number, Section>>
): void {
  const id = node.getAttribute('id') || '';
  const title = node.getAttribute('title') || '';
  const literal = node.getAttribute('literal');
  const page = parseInt(node.getAttribute('page') || '');
  const y = parseFloat(node.getAttribute('y') || '');
  const qualified = node.getAttribute('qualified') || '';
  const numRefs = node.getElementsByTagName('reference').length;
  const type = Section.parseSegmentType(node.getAttribute('type'));
  const fullTitle = Section.getFullTitle(node);

  const showBookmark =
    !node.getAttribute('show') || node.getAttribute('show') === 'true';
  const bookmarkTitle = node.getAttribute('bookmark');

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

  mapping[section.id] = section;
  for (const child of node.children) {
    if (child.tagName === 'section') {
      addSectionReference(child, mapping);
    }
  }
}

export type PdfOutline = ReturnType<typeof createPdfOutline>;

export function createPdfOutline() {
  const [sectionReferenceMap, setSectionReferenceMap] = createSignal<
    Partial<Record<number, Section>>
  >({});

  return {
    sectionReferenceMap,
    commands: {
      loadCoparse(coparse: ICoParse) {
        const firstChild = XMLUtils.parse(coparse.toc || '').firstChild as
          | Element
          | undefined;
        const mapping: Partial<Record<number, Section>> = {};
        for (const child of firstChild?.children ?? []) {
          if (child.tagName === 'section') {
            addSectionReference(child, mapping);
          }
        }
        setSectionReferenceMap(mapping);
      },
    },
  };
}
