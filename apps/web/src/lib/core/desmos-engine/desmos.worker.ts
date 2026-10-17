import { loadDesmosEngineWasm, type WasmDesmosGraph } from './wasm-module';

type Request =
  | { id: number; kind: 'open'; json: string }
  | { id: number; kind: 'plot' }
  | { id: number; kind: 'json' }
  | { id: number; kind: 'setLatex'; exprId: string; latex: string }
  | { id: number; kind: 'setColor'; exprId: string; color: string }
  | { id: number; kind: 'setHidden'; exprId: string; hidden: boolean }
  | { id: number; kind: 'addExpression' }
  | { id: number; kind: 'remove'; exprId: string }
  | {
      id: number;
      kind: 'setViewport';
      xmin: number;
      xmax: number;
      ymin: number;
      ymax: number;
    }
  | { id: number; kind: 'setSlider'; exprId: string; value: number }
  | { id: number; kind: 'addSlider'; name: string };

let graph: WasmDesmosGraph | undefined;

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const wasm = await loadDesmosEngineWasm();
    switch (request.kind) {
      case 'open':
        graph?.free();
        graph = new wasm.DesmosGraph(request.json);
        self.postMessage({ id: request.id, ok: true, json: graph.to_json() });
        return;
      case 'plot':
        self.postMessage({
          id: request.id,
          ok: true,
          plot: graph?.plot() ?? 'null',
        });
        return;
      case 'json':
        self.postMessage({
          id: request.id,
          ok: true,
          json: graph?.to_json() ?? '',
        });
        return;
      case 'setLatex':
        graph?.setLatex(request.exprId, request.latex);
        break;
      case 'setColor':
        graph?.setColor(request.exprId, request.color);
        break;
      case 'setHidden':
        graph?.setHidden(request.exprId, request.hidden);
        break;
      case 'addExpression':
        graph?.addExpression();
        break;
      case 'remove':
        graph?.remove(request.exprId);
        break;
      case 'setViewport':
        graph?.setViewport(
          request.xmin,
          request.xmax,
          request.ymin,
          request.ymax
        );
        break;
      case 'setSlider':
        graph?.setSlider(request.exprId, request.value);
        break;
      case 'addSlider':
        graph?.addSlider(request.name);
        break;
    }
    self.postMessage({
      id: request.id,
      ok: true,
      json: graph?.to_json() ?? '',
      plot: graph?.plot() ?? 'null',
    });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
