export default function (error: unknown): { [name: string]: any } {
  if (error instanceof Error) {
    return {
      'error.message': error.message,
      'error.stack': error.stack?.split('\n    at '),
    };
  } else if (error instanceof Object) {
    return {
      'error.message': JSON.stringify(error),
    };
  } else {
    return {
      'error.message': error?.toString(),
    };
  }
}
