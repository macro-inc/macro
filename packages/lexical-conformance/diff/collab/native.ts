import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
export type Observation = {
  value: unknown;
  editor: { root: Node };
  bytes: number[];
  history: { undo: boolean; redo: boolean };
};
export type Node = {
  type: string;
  text?: string;
  children?: Node[];
  [key: string]: unknown;
};
export type Edit = {
  kind:
    | 'insert'
    | 'paragraph'
    | 'linebreak'
    | 'tab'
    | 'remove'
    | 'format'
    | 'undo'
    | 'redo';
  path: number[];
  from: number;
  to: number;
  text: string;
  now: number;
};
export class Native {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending: Array<{
    resolve: (value: Observation) => void;
    reject: (error: Error) => void;
  }> = [];
  private stderr = '';
  constructor() {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../..'
    );
    const target = path.resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
    this.child = spawn(path.join(target, 'debug/examples/collab'), [], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const next = this.pending.shift();
      if (!next) throw new Error('unsolicited native response');
      try {
        const value = JSON.parse(line);
        if (value.error) next.reject(new Error(value.error));
        else next.resolve(value);
      } catch (error) {
        next.reject(error as Error);
      }
    });
    this.child.on('exit', (code) => {
      for (const pending of this.pending.splice(0))
        pending.reject(new Error(`native exited ${code}: ${this.stderr}`));
    });
  }
  request(peer: number, input: Record<string, unknown>): Promise<Observation> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child.stdin.write(JSON.stringify({ peer, ...input }) + '\n');
    });
  }
  close() {
    this.child.stdin.end();
  }
}
