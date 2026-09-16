import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  displayResultsInstructions,
  displayResultsPromptBody,
} from './toolSchema';

/**
 * The prompt the backend composes into the agent-session system prompt is
 * generated from the Zod `ViewSchema` here — an agent session's turn runs
 * entirely on the backend, so nothing frontend-side is in that loop to build
 * it at request time the way chat does.
 *
 * Widening the schema without regenerating would leave the session model
 * describing views the renderer rejects, so the two are pinned together here
 * rather than only by `bun run check`.
 */
// Vitest runs with `apps/web` as the working directory.
const GENERATED = resolve(
  process.cwd(),
  '../../crates/prompt/src/dynamic_ui.generated.md'
);

describe('displayResults prompt', () => {
  it('matches the copy the Rust prompt crate includes', () => {
    expect(readFileSync(GENERATED, 'utf8')).toBe(
      `${displayResultsPromptBody()}\n`
    );
  });

  it('carries the view schema under a heading chat can append as its own section', () => {
    const instructions = displayResultsInstructions();
    expect(instructions.startsWith('# displayResults\n')).toBe(true);
    expect(instructions).toContain('"widgets"');
    // The generated copy is filed under the Rust `StaticPrompt` title, which
    // prints the same heading — so the body must not carry one of its own.
    expect(displayResultsPromptBody().startsWith('#')).toBe(false);
  });
});
