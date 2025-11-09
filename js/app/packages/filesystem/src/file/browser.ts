import {
  BaseFile,
  BrowserHandle,
  ConstructorArgs,
  FileFromDisk,
  FileSource,
} from './base';

export class BrowserFile
  extends BaseFile<BrowserHandle>
  implements FileFromDisk
{
  readonly source: FileSource.Browser;

  constructor(args: ConstructorArgs<BrowserHandle>) {
    super(args);
    this.source = FileSource.Browser;
  }
}
