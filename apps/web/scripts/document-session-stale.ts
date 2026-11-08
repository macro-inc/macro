import { stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import graph from '../../../.github/workspace-dep-closures.json';
const artifact=await stat(process.argv[2]);
const root=resolve(import.meta.dirname,'../../..');
const paths:string[]=graph.closures.document_session_wasm;
async function newer(path:string):Promise<boolean>{const s=await stat(path);if(s.isDirectory()){for(const e of await readdir(path)){if(e==='target'||e==='node_modules')continue;if(await newer(resolve(path,e)))return true;}return false;}return s.mtimeMs>artifact.mtimeMs;}
for(const path of [...paths,'Cargo.toml','Cargo.lock','.cargo/config.toml'])if(await newer(resolve(root,path)))process.exit(0);
process.exit(1);
