import { brotliCompressSync, constants } from 'node:zlib';
const path=process.argv[2];
if(!path)throw new Error('Pass the optimized session wasm path');
const bytes=await Bun.file(path).bytes();
const compressed=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}});
console.log(`document_session_wasm: raw=${bytes.length} brotli=${compressed.length}`);
if(bytes.length>8_000_000)throw new Error('Session wasm exceeds the 8 MB artifact gate');
if(compressed.length>1_130_000)throw new Error('Session wasm exceeds the provisional 1,130,000-byte brotli gate');
