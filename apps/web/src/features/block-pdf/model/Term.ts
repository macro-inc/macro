interface ITerm {
  name: string;
  readonly definition: Element;
  id: string;
  pageNum: number;
  yPos: number;
  numRefs: number;
  readonly references: HTMLCollectionOf<Element>;
  sims: string[];
}

class Term implements ITerm {
  public name: string;
  public lowercaseName: string;
  public definition: Element;
  public id: string;
  public pageNum: number;
  public yPos: number;
  public numRefs: number;
  public index?: number;
  public references: HTMLCollectionOf<Element>;
  public sims: string[];

  // are these needed? Not if we use Popper to position these
  // public centerX?: number;
  // public rowWidth?: number;
  // public viewerBounds?: DOMRect;
  // public realTopY?: number;
  // public topY?: number;

  public refPageNum?: number;
  public tokenID?: string;

  constructor({
    name,
    definition,
    id,
    pageNum,
    yPos,
    numRefs,
    references,
    sims,
  }: ITerm) {
    if (typeof name !== 'string' || !name) {
      console.error('Invalid term name');
    } else if (!definition) {
      console.error('Invalid term definition');
    } else if (!id || typeof id !== 'string') {
      console.error('Invalid term ID');
    } else if (typeof pageNum !== 'number' || pageNum < 0) {
      console.error('Invalid term pageNum');
    } else if (typeof numRefs !== 'number' || numRefs < 0) {
      console.error('Invalid term numRefs');
    }

    this.name = name;
    this.definition = definition;
    this.id = id;
    this.pageNum = pageNum;
    this.yPos = yPos;
    this.numRefs = numRefs;
    this.lowercaseName = this.name.toLowerCase(); // Prepare for search
    this.references = references;
    this.sims = sims;
  }

  // getMiddleToken() {
  //   return this.tokens[Math.ceil(this.tokens.length / 2) - 1];
  // }

  clone(): Term {
    return new Term({
      name: this.name,
      definition: this.definition,
      id: this.id,
      pageNum: this.pageNum,
      yPos: this.yPos,
      numRefs: this.numRefs,
      references: this.references,
      sims: this.sims,
    });
  }
}

export default Term;
