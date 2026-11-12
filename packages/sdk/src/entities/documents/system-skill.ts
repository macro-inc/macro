import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * A built-in system skill: static, code-defined AI instructions that surface
 * to AI like skill documents but have no document behind them. System skills
 * cannot be opened, edited, or deleted; reference them in AI inputs by id the
 * same way as skill documents, and read their instructions with `content()`.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class SystemSkill {
  private constructor(
    private readonly client: MacroClient,
    /** The well-known id the skill is referenced by in mentions and AI tools. */
    readonly id: string,
    /** The skill's display name. */
    readonly name: string,
  ) {}

  /**
   * The skill's complete markdown instructions. Read them before doing the
   * task the skill was named for, and follow them for that request only.
   *
   * @readonly
   */
  async content(): Promise<string> {
    return unwrap(
      await this.client.cognition.readSkill({ path: { id: this.id } }),
    ).content;
  }

  /** Identity and name, without the authenticated client. */
  toJSON(): { id: string; name: string } {
    return { id: this.id, name: this.name };
  }

  /** The built-in system skills, in display order. */
  static async list(client: MacroClient): Promise<SystemSkill[]> {
    const { skills } = unwrap(await client.storage.getSystemSkillsHandler());
    return skills.map((skill) => new SystemSkill(client, skill.id, skill.name));
  }

  /** Wrap a built-in skill from a record already in hand, such as a skill listing. */
  static from(
    client: MacroClient,
    record: { id: string; name: string },
  ): SystemSkill {
    return new SystemSkill(client, record.id, record.name);
  }
}
