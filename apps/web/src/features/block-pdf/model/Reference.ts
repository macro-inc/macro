interface IReference {
  pageNum: number;
  yPos: number;
  sectionId: number | null;
  context: string;
}

class Reference implements IReference {
  pageNum: number;
  yPos: number;
  sectionId: number | null;
  context: string;

  constructor({ pageNum, yPos, sectionId, context }: IReference) {
    if (typeof pageNum !== 'number' || pageNum < 0) {
      console.error('Invalid reference pageNum');
    } else if (typeof yPos !== 'number' || !yPos) {
      console.error('Invalid reference yPos');
    } else if (!context || typeof context !== 'string') {
      console.error('Invalid reference context');
    }

    this.pageNum = pageNum;
    this.yPos = yPos;
    this.sectionId = sectionId;
    this.context = context;
  }

  static fromXML(xml: Element): Reference {
    const context = document.createElement('textarea');
    context.innerHTML = xml.textContent || '';
    const rawSectionId = xml.getAttribute('section');
    const parsedSectionId =
      rawSectionId == null ? Number.NaN : parseInt(rawSectionId, 10);

    return new Reference({
      pageNum: parseInt(xml.getAttribute('page') || ''),
      yPos: parseInt(xml.getAttribute('y') || ''),
      sectionId: Number.isNaN(parsedSectionId) ? null : parsedSectionId,
      context: context.value,
    });
  }
}

export default Reference;
