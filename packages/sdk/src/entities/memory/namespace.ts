import type {
  ExplicitMemory,
  MemoryEdit,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

export type { ExplicitMemory, MemoryEdit };

/**
 * The acting user's private explicit memory: the preferences and facts they
 * asked AI to remember, one per line.
 *
 * @routing Use when the user asks to remember, correct or forget something, or to see what AI remembers about them; not what someone worked on (`macro.activity`, `User.activity`).
 *
 * @agent Change memory only when the user explicitly asks to remember,
 * correct or forget something; never save inferred preferences. Read first:
 * edits address one-based lines and must carry the revision you read. A
 * stale revision fails with 409 and changes nothing; read again and reconcile
 * before retrying. Private or sensitive additions are rejected with 422.
 */
export class MemoryNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Read the acting user's explicit memory and its revision; `content` is
   * newline-separated, and edits address its one-based lines.
   *
   * @example
   * const memory = await macro.memory.read();
   * const lines = memory.content.split('\n');
   *
   * @readonly
   */
  async read(): Promise<ExplicitMemory> {
    return unwrap(await this.client.cognition.readExplicitMemory());
  }

  /**
   * Apply one line edit at the `revision` you read, only when the user asked
   * to remember, correct or forget something; returns the new memory and
   * revision.
   *
   * A stale revision fails with 409 and changes nothing: read again before
   * retrying. Insert at `lines.length + 1` to append.
   *
   * @example
   * const memory = await macro.memory.read();
   * const lines = memory.content ? memory.content.split('\n') : [];
   * await macro.memory.edit(
   *   { action: 'insert', line: lines.length + 1, content: 'Prefers metric units' },
   *   memory.revision,
   * );
   *
   * @destructive
   */
  async edit(edit: MemoryEdit, revision: number): Promise<ExplicitMemory> {
    return unwrap(
      await this.client.cognition.editExplicitMemory({
        body: { edit, revision },
      }),
    );
  }
}
