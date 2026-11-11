import * as nodeFs from 'node:fs/promises';
// Schedules: Macro routines the agent creates for itself. A routine run opens
// an agent session owned by the agent with source `routine`; its
// `agent_session.opened` event arrives on the brain's stream, and the brain
// turns it into a wake-up carrying the schedule's note. The routine itself
// does nothing but exist: its prompt tells the run to stop at once.
// The mapping from routine to note lives in memory/schedules.json.
import type { SessionOpened } from './events.ts';
import type { GitWriter, Workspace } from './workspace.ts';
export type Trigger =
  | {
      type: 'cron';
      schedule: string;
      timezone: string;
    }
  | {
      type: 'once';
      at: string;
    };
export type RoutineRecord = {
  id: string;
  name: string;
};
/** The routine calls the brain makes (the SDK adapter implements it). */
export interface Routines {
  create(options: {
    name: string;
    prompt: string;
    model: string;
    trigger: Trigger;
  }): Promise<RoutineRecord>;
  list(): Promise<RoutineRecord[]>;
  delete(id: string): Promise<void>;
}
export type Schedule = {
  routineId: string;
  routineName: string;
  /** What to do when it fires, in the agent's words. */
  note: string;
  trigger: Trigger;
};
export type Wake = {
  schedule: Schedule | null;
  sessionName: string;
};
const FILE = 'memory/schedules.json';
const PREFIX = 'wake: ';
const ROUTINE_PROMPT =
  'This routine only wakes its owner. Reply "ok" and stop; do nothing else.';
export class Schedules {
  private readonly workspace: Workspace;
  private readonly writer: GitWriter;
  private readonly routines: Routines;
  private readonly model: string;
  constructor(
    workspace: Workspace,
    writer: GitWriter,
    routines: Routines,
    model: string
  ) {
    this.workspace = workspace;
    this.writer = writer;
    this.routines = routines;
    this.model = model;
  }
  async list(): Promise<Schedule[]> {
    let text: string;
    try {
      text = await nodeFs.readFile(this.workspace.path(FILE), 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    }
    return JSON.parse(text) as Schedule[];
  }
  async create(note: string, trigger: Trigger): Promise<Schedule> {
    const routineName = `${PREFIX}${note.replace(/\s+/g, ' ').trim().slice(0, 80)}`;
    const routine = await this.routines.create({
      name: routineName,
      prompt: ROUTINE_PROMPT,
      model: this.model,
      trigger,
    });
    const schedule: Schedule = {
      routineId: routine.id,
      routineName: routine.name,
      note,
      trigger,
    };
    await this.save([...(await this.list()), schedule]);
    return schedule;
  }
  async delete(routineId: string): Promise<void> {
    await this.routines.delete(routineId);
    await this.save(
      (await this.list()).filter((schedule) => schedule.routineId !== routineId)
    );
  }
  /**
   * The wake-up an `agent_session.opened` event stands for, or null when it
   * isn't one of the agent's routine runs. A routine run the brain has no
   * record of still wakes it, with its session name, so nothing is lost.
   */
  async wakeFor(opened: SessionOpened, me: string): Promise<Wake | null> {
    const { identity } = opened;
    if (identity.source !== 'routine' || identity.owner_id !== me) return null;
    const schedule =
      (await this.list()).find((found) =>
        identity.session_name.startsWith(found.routineName)
      ) ?? null;
    return { schedule, sessionName: identity.session_name };
  }
  /** Forget schedules whose routine no longer exists in Macro. */
  async reconcile(): Promise<number> {
    const live = new Set(
      (await this.routines.list()).map((routine) => routine.id)
    );
    const all = await this.list();
    const kept = all.filter((schedule) => live.has(schedule.routineId));
    if (kept.length !== all.length) await this.save(kept);
    return all.length - kept.length;
  }
  private async save(schedules: Schedule[]): Promise<void> {
    await this.writer.write(FILE, `${JSON.stringify(schedules, null, 2)}\n`);
  }
}
