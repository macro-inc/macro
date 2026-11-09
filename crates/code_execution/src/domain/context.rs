//! What an attended program's `main` receives, as the ambient declarations it
//! is type-checked with. The SDK's own declarations come from the checker.

use super::RunEnvironment;

/// `CodeContext` with what every attended run gets.
const BASE: &str = r#"import type { CodeExecution, Macro, MacroOpts } from '@macro-inc/sdk';

declare global {
  /** What an ExecuteCode program's `main` receives. */
  interface CodeContext {
    /** Macro's SDK, authenticated as the acting account. */
    macro: Macro;
    /** A short-lived credential for `new Macro({ token, hosts, webAppUrl })`. Never print, return or persist it. */
    token: string;
    /** The SDK's service hosts for this deployment. */
    hosts: NonNullable<MacroOpts['hosts']>;
    /** The web app origin `webUrl()` links start with. */
    webAppUrl: string;
  }
"#;

/// Added when the run belongs to an agent session.
const SESSION: &str = r#"
  interface CodeContext {
    /** The agent session this program runs in. */
    session: ReturnType<Macro['agentSessions']['byId']>;
    /** The session's id. */
    sessionId: string;
  }
"#;

/// Added when the run is one of a session's code executions.
const EXECUTION: &str = r#"
  interface CodeContext {
    /** This execution, for its reviews and views. */
    execution: CodeExecution;
    /** The execution's id. */
    executionId: string;
  }
"#;

/// The declarations for a run in `environment`: `session` and `execution`
/// are declared exactly when the bootstrap passes them to `main`.
pub(crate) fn program_context(environment: &RunEnvironment) -> String {
    let mut declarations = BASE.to_owned();
    if environment.session_id.is_some() {
        declarations.push_str(SESSION);
        if environment.execution_id.is_some() {
            declarations.push_str(EXECUTION);
        }
    }
    declarations.push_str("}\n");
    declarations
}
