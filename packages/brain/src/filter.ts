/** Shared admission path for live intake and supervisor regression replay. */
import { AGENT_SESSION_OPENED, MESSAGE_POSTED } from './events.ts';
import { type Candidate, type Decision, judge } from './jev.ts';
import type { MustWakeFixture } from './learning.ts';
import type { MacroHttp } from './macro.ts';
import type { Wiring } from './wiring.ts';
import type { Workspace } from './workspace.ts';

export class Filter {
  private readonly workspace: Workspace;
  private readonly wiring: Wiring;
  private readonly http: MacroHttp;
  private readonly log: (line: object) => Promise<void>;
  constructor(
    workspace: Workspace,
    wiring: Wiring,
    http: MacroHttp,
    log: (line: object) => Promise<void>
  ) {
    this.workspace = workspace;
    this.wiring = wiring;
    this.http = http;
    this.log = log;
  }
  /** The same filter used by intake and supervisor-owned regression replay. */
  async evaluate(
    candidate: Candidate,
    probabilities?: Record<string, number>
  ): Promise<Decision> {
    const deterministic = await this.wiring.triage?.(candidate);
    let decision: Decision;
    if (deterministic !== undefined)
      decision = {
        relevant: deterministic,
        reason: 'deterministic',
        probabilities: {},
      };
    else
      decision = await (this.wiring.relevance ?? judge)(candidate, {
        config: () => this.workspace.jev(),
        decide: (request) =>
          probabilities
            ? Promise.resolve({ probabilities })
            : this.http.decide(request),
        log: (line) => this.log(line),
      });
    if (
      candidate.fromCreator ||
      candidate.directMessage ||
      candidate.mentionsMe
    )
      return { ...decision, relevant: true };
    return decision;
  }
  async checkFixture(fixture: MustWakeFixture): Promise<boolean> {
    const persona = await this.workspace.persona();
    const events = [
      MESSAGE_POSTED,
      AGENT_SESSION_OPENED,
      ...persona.events.events,
      ...(this.wiring.subscriptions ?? []),
    ];
    if (!events.includes('*') && !events.includes(fixture.eventType))
      return false;
    return (await this.evaluate(fixture.candidate, fixture.probabilities))
      .relevant;
  }
}
