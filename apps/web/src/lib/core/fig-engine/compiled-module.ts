/**
 * Share compiled code across file engines and raster workers. Each worker
 * still gets its own instance and memory; closing a file releases its data.
 */
let compiled: Promise<WebAssembly.Module> | undefined;

export function compiledFigModule(): Promise<WebAssembly.Module> {
  if (!compiled) compiled = compile();
  return compiled;
}

async function compile(): Promise<WebAssembly.Module> {
  try {
    const url = new URL('./wasm/fig_engine_bg.wasm', import.meta.url);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Unable to load design engine (${response.status})`);
    // Streaming starts compilation while the remaining bytes download.
    // Some desktop protocols do not provide the application/wasm MIME type.
    if (
      response.headers.get('content-type')?.split(';')[0] === 'application/wasm'
    )
      return await WebAssembly.compileStreaming(response);
    return await WebAssembly.compile(await response.arrayBuffer());
  } catch (error) {
    compiled = undefined;
    throw error;
  }
}
