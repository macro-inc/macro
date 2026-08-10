import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * A built-in system skill: static, code-defined AI instructions that surface
 * to AI like skill documents but have no document behind them. System skills
 * cannot be opened, edited, or deleted; reference them in AI inputs by id the
 * same way as skill documents.
 */
export class SystemSkill {
  private constructor(
    /** The well-known id the skill is referenced by in mentions and AI tools. */
    readonly id: string,
    /** The skill's display name. */
    readonly name: string,
  ) {}

  /** The built-in system skills, in display order. */
  static async list(client: MacroClient): Promise<SystemSkill[]> {
    const { skills } = unwrap(await client.storage.getSystemSkillsHandler());
    return skills.map((skill) => new SystemSkill(skill.id, skill.name));
  }
}
