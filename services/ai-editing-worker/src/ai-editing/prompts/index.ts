/**
 * System prompts, composed from single-purpose markdown sections.
 *
 * Each `.md` file is one section that says one thing; a role's system prompt
 * is the concatenation below. Keep role files to what is specific to that
 * role and put anything two roles need in a shared section, so a rule is
 * written once and every role that edits inherits it.
 *
 * - GROUND_RULES: how the document is shown (XML view, ids). Every role.
 * - TEAM: the supervisor/writer split and parallel batching. Supervised
 *   pipeline roles only — the fast editor works alone.
 * - EDITING_RULES: how `runCode` and `editor` are used. Anyone who edits.
 * - API_COMPLETE: the full `editor` API reference. Anyone who edits.
 * - SUPERVISOR / CODER / FAST / INTERPRET: role-specific text.
 */
import API_COMPACT from './API_COMPACT.md';
import API_COMPLETE from './API_COMPLETE.md';
import CODER from './CODER.md';
import EDITING_RULES from './EDITING_RULES.md';
import FAST from './FAST.md';
import GROUND_RULES from './GROUND_RULES.md';
import INTERPRET from './INTERPRET.md';
import SUPERVISOR from './SUPERVISOR.md';
import TEAM from './TEAM.md';

// TODO(wolf): figure out if we want this. Leaving it off for now.
const USE_COMPACT = false;

const join = (...sections: string[]) => sections.join('\n');

export const SUPERVISOR_SYSTEM = join(
  TEAM,
  GROUND_RULES,
  SUPERVISOR,
  ...(USE_COMPACT ? [API_COMPACT] : [])
);

export const INTERPRET_SYSTEM = join(TEAM, GROUND_RULES, INTERPRET);

export const CODER_SYSTEM = join(
  TEAM,
  GROUND_RULES,
  CODER,
  EDITING_RULES,
  API_COMPLETE
);

export const FAST_SYSTEM = join(
  GROUND_RULES,
  FAST,
  EDITING_RULES,
  API_COMPLETE
);
