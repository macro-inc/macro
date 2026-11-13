// A session program's import map points node:process here. Its own named
// getBuiltinModule was bound before the bootstrap wrapped
// process.getBuiltinModule, so this one calls the wrapper; see bootstrap.mjs.
export * from "node:process";
export { default } from "node:process";
export const getBuiltinModule = (...args) => process.getBuiltinModule(...args);
