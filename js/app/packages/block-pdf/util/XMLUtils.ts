export class XMLUtils {
  public static parse(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'application/xml');
  }
}
