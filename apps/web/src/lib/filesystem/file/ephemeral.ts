import { BaseFile, ConstructorArgs } from './base';

/*
 * An ephemeral file is an instance of BaseFile which does not have a filehandle
 * this could be due to runtime context, e.g. legacy browser which doesnt have a file handle api
 * It can also be due to a new file being created that hasn't been saved-as yet, e.g. converting a docx to pdf
 */
export class EphemeralFile extends BaseFile<undefined> {
  readonly source: null;

  constructor(args: ConstructorArgs<undefined>) {
    super(args);
    this.source = null;
  }

  public updateBytes(fileBits: Array<BlobPart>): EphemeralFile {
    return new EphemeralFile({
      fileBits,
      fileName: this.name,
      options: {
        type: this.type,
        lastModified: this.lastModified,
      },
      handle: this.filehandle,
    });
  }
}
