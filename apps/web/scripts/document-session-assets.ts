import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
/** Emit the optional session package without eagerly downloading it on flag-off pages. */
export function documentSessionAssets():Plugin {
 return {name:'document-session-assets',apply:'build',buildStart(){
  for(const name of ['document_session_wasm.js','document_session_wasm_bg.wasm'])this.emitFile({type:'asset',name,source:readFileSync(new URL(`../src/lib/core/document-session/wasm/${name}`,import.meta.url))});
 }};
}
