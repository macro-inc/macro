/**
 * Who gives the agent orders. The owner in `agent.json` does only while they
 * are a member of the agent's team, checked before every wake; once they
 * leave, the team's owner does, and is told once. A team that can't be read
 * keeps the last decision.
 */
import type { Agent } from '@macro-inc/muppet/core/agent';
import type { Disk } from '../context/disk.ts';

const authorityOwner = 'authority';

/** Where the decision and the notice live, in the agent's state. */
export const authorityFiles = (
  state: {
    readonly run: (owner: string) => string;
    readonly memory: (owner: string) => string;
  },
  join: (...parts: readonly string[]) => string
) => ({
  current: join(state.run(authorityOwner), 'owner'),
  told: join(state.memory(authorityOwner), 'told'),
});

/** The agent's team, as far as authority goes. */
export type Team = {
  readonly owner: string;
  readonly members: readonly string[];
};

export type Authority = {
  /** The user whose word is an order now. */
  readonly owner: () => string;
  /** Read the team again and decide. */
  readonly refresh: () => Promise<void>;
};

const handover = (configured: string): string =>
  `${configured} has left the team, so I take instructions from you now, as the team's owner. To give me a new owner, change "owner" in my agent.json.`;

export const authority = ({
  configured,
  initial,
  team,
  disk,
  files,
  tell,
}: {
  /** The owner `agent.json` names. */
  readonly configured: string;
  /** The last decision, if one was written; the configured owner otherwise. */
  readonly initial?: string;
  readonly team: () => Promise<Team>;
  readonly disk: Pick<Disk, 'read' | 'write'>;
  readonly files: {
    /** The decision, for scripts' processes to read; volatile. */
    readonly current: string;
    /** Whom the team owner was told about, so a restart doesn't tell again; committed. */
    readonly told: string;
  };
  readonly tell: (to: string, text: string) => Promise<void>;
}): Authority => {
  let owner = initial ?? configured;
  return {
    owner: () => owner,
    refresh: async () => {
      let read: Team;
      try {
        read = await team();
      } catch (error) {
        console.warn(
          'could not read the team; the authority stays as it was',
          error
        );
        return;
      }
      const member = read.members.includes(configured);
      owner = member ? configured : read.owner;
      await disk.write(files.current, `${owner}\n`);
      const told = (await disk.read(files.told))?.trim() || undefined;
      if (member) {
        if (told !== undefined) await disk.write(files.told, '');
        return;
      }
      if (told === configured) return;
      await tell(read.owner, handover(configured));
      await disk.write(files.told, `${configured}\n`);
    },
  };
};

/** The agent, deciding its authority before every wake. */
export const authorized = ({
  agent,
  authority: owners,
}: {
  readonly agent: Agent;
  readonly authority: Authority;
}): Agent => ({
  wake: async (wake) => {
    await owners.refresh();
    return agent.wake(wake);
  },
});
