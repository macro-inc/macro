import TocUtils from '../util/TocUtils';
import type Section from './Section';

interface IReference {
  pageNum: number;
  yPos: number;
  sectionName: string;
  context: string;
}

class Reference implements IReference {
  pageNum: number;
  yPos: number;
  sectionName: string;
  context: string;

  constructor({ pageNum, yPos, sectionName, context }: IReference) {
    if (typeof pageNum !== 'number' || pageNum < 0) {
      console.error('Invalid reference pageNum');
    } else if (typeof yPos !== 'number' || !yPos) {
      console.error('Invalid reference yPos');
    } else if (typeof sectionName !== 'string') {
      console.error('Invalid reference sectionName');
    } else if (!context || typeof context !== 'string') {
      console.error('Invalid reference context');
    }

    this.pageNum = pageNum;
    this.yPos = yPos;
    this.sectionName = sectionName;
    this.context = context;
  }

  static fromXML(
    xml: Element,
    {
      idToSectionMap,
    }: {
      idToSectionMap: Partial<Record<number, Section>>;
    }
  ): Reference {
    const sectionID = parseInt(xml.getAttribute('section') || '');
    let sectionName: string;
    try {
      const section = TocUtils.getSection({ id: sectionID, idToSectionMap });
      sectionName = section?.fullDescriptor || '';
    } catch (_e) {
      sectionName = '';
    }

    const context = document.createElement('textarea');
    context.innerHTML = xml.textContent || '';

    return new Reference({
      pageNum: parseInt(xml.getAttribute('page') || ''),
      yPos: parseInt(xml.getAttribute('y') || ''),
      sectionName: sectionName,
      context: context.value,
    });
  }
}

export default Reference;
