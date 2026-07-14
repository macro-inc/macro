export class FileSystemError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'FileSystem Error';
  }
}

export class UserError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'User Error';
  }
}

export class AlreadyCheckedOutError extends Error {
  readonly checkedOutBy: string;
  readonly id: string;
  constructor(
    msg: string,
    { checkedOutBy, id }: { checkedOutBy: string; id: string }
  ) {
    super(msg);
    this.name = 'Already Checked Out Error';
    this.checkedOutBy = checkedOutBy;
    this.id = id;
  }
}

export class NotImplementedError extends Error {
  constructor(msg?: string) {
    super(msg);
    this.name = 'Not Implemented Error';
  }
}
