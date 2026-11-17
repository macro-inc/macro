type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type Listener = (params: Record<string, unknown>) => void;

/** A minimal Chrome DevTools Protocol client over one page WebSocket. */
export class Cdp {
  #socket: WebSocket;
  #next = 1;
  #pending = new Map<number, Pending>();
  #listeners = new Map<string, Set<Listener>>();
  readonly closed: Promise<void>;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    this.closed = new Promise((resolve) => {
      socket.addEventListener('close', () => {
        for (const pending of this.#pending.values())
          pending.reject(new Error('DevTools connection closed'));
        this.#pending.clear();
        resolve();
      });
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result);
        return;
      }
      if (message.method)
        for (const listener of this.#listeners.get(message.method) ?? [])
          listener(message.params ?? {});
    });
  }

  static connect(url: string, timeoutMs: number): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to ${url}`));
      }, timeoutMs);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve(new Cdp(socket));
        },
        { once: true }
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(`Cannot connect to ${url}`));
        },
        { once: true }
      );
    });
  }

  /** Sends a command; rejects when the page is gone or does not answer. */
  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<T> {
    if (this.#socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('DevTools connection closed'));
    const id = this.#next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`DevTools ${method} timed out`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: Listener): () => void {
    let listeners = this.#listeners.get(method);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(method, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Evaluates an expression in the page and returns its JSON value. */
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value?: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
      );
    return result.result.value as T;
  }

  close() {
    this.#socket.close();
  }
}
