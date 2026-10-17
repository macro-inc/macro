import type { GraphDocument, PlotScene, Viewport } from './types';

type Ok = {
  id: number;
  ok: true;
  json?: string;
  plot?: string;
  exprId?: string;
};
type Response = Ok | { id: number; ok: false; error: string };

/**
 * One open graph, hosted in a worker. Constructed on first use so iOS
 * WKWebView does not deadlock on an eager module worker.
 */
export class DesmosEngine {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: Ok) => void; reject: (error: Error) => void }
  >();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./desmos.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<Response>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) pending.resolve(event.data);
      else pending.reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Desmos engine worker failed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private request(body: Record<string, unknown>): Promise<Ok> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensureWorker().postMessage({ ...body, id });
    });
  }

  private scene(plot: string | undefined): PlotScene {
    return JSON.parse(
      plot ??
        '{"viewport":{"xmin":-10,"xmax":10,"ymin":-10,"ymax":10},"items":[],"neededSliders":[]}'
    ) as PlotScene;
  }

  private document(json: string | undefined): GraphDocument {
    return JSON.parse(json ?? '{}') as GraphDocument;
  }

  async open(json: string): Promise<GraphDocument> {
    return this.document((await this.request({ kind: 'open', json })).json);
  }

  async plot(): Promise<PlotScene> {
    return this.scene((await this.request({ kind: 'plot' })).plot);
  }

  async toJson(): Promise<string> {
    return (await this.request({ kind: 'json' })).json ?? '';
  }

  async setLatex(id: string, latex: string) {
    const response = await this.request({
      kind: 'setLatex',
      exprId: id,
      latex,
    });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  async setColor(id: string, color: string) {
    const response = await this.request({
      kind: 'setColor',
      exprId: id,
      color,
    });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  async setHidden(id: string, hidden: boolean) {
    const response = await this.request({
      kind: 'setHidden',
      exprId: id,
      hidden,
    });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  async addExpression() {
    const response = await this.request({ kind: 'addExpression' });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  async remove(id: string) {
    const response = await this.request({ kind: 'remove', exprId: id });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  async setViewport(viewport: Viewport) {
    const response = await this.request({ kind: 'setViewport', ...viewport });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  async setSlider(id: string, value: number) {
    const response = await this.request({
      kind: 'setSlider',
      exprId: id,
      value,
    });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  async addSlider(name: string) {
    const response = await this.request({ kind: 'addSlider', name });
    return {
      document: this.document(response.json),
      scene: this.scene(response.plot),
    };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.pending.clear();
  }
}
