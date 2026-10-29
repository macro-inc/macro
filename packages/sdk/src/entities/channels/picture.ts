/** An uploaded channel profile picture in static file storage. */
export class ChannelPicture {
  private constructor(/** Uploaded picture identity. */ readonly id: string) {}

  /** Construct a reference from the upload receipt. */
  static byId(id: string): ChannelPicture {
    return new ChannelPicture(id);
  }

  /** Serialize the uploaded picture reference. */
  toJSON() {
    return { id: this.id };
  }
}
