declare global {
  interface Window {
    require: NodeRequire;
    process: {
      type: string | undefined;
    };
  }
}
