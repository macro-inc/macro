//! Emit host-facing connection env for seeding an instance.
//!
//! Dockerized services reach each other over the compose network
//! (`postgres:5432`, `fusionauth:9011`, ...), but the seed CLI runs on the host
//! and needs `localhost:<host-port>`. This prints `eval`-able shell exports so
//! `just seed-scenario` can target a `run_local --instance <name>` stack. Each
//! export preserves a value already in the environment (`${VAR:-...}`), so
//! explicit overrides still win and the default instance reproduces the
//! recipe's historical fixed-port defaults exactly.
//!
//! Sync-service and lexical-service are not instance-isolated (their compose
//! ports are hardcoded to 8787/8096), so document content is left to the seed
//! recipe's shared defaults rather than emitted here.

#[cfg(test)]
mod test;

use anyhow::Result;

use super::instance::{Instance, Port};

/// Print `export KEY="${KEY:-<host value>}"` lines for the instance's
/// host-facing connection endpoints.
pub fn emit(instance: &Instance) -> Result<()> {
    print!("{}", render(instance));
    Ok(())
}

/// The `eval`-able export block for the instance's host-facing endpoints. Each
/// line preserves any value already in the environment so explicit overrides
/// win and the default instance reproduces the recipe's fixed-port defaults.
fn render(instance: &Instance) -> String {
    let postgres = instance.port(Port::Postgres);
    let localstack = instance.port(Port::LocalStack);
    let fusionauth = instance.port(Port::FusionAuth);
    let frontend = instance.port(Port::Frontend);

    [
        format!(
            r#"export DATABASE_URL="${{DATABASE_URL:-postgres://user:password@localhost:{postgres}/macrodb}}""#
        ),
        format!(r#"export LOCAL_AWS_URL="${{LOCAL_AWS_URL:-http://localhost:{localstack}}}""#),
        format!(
            r#"export FUSIONAUTH_BASE_URL="${{FUSIONAUTH_BASE_URL:-http://localhost:{fusionauth}}}""#
        ),
        format!(r#"export FRONTEND_PORT="${{FRONTEND_PORT:-{frontend}}}""#),
    ]
    .join("\n")
        + "\n"
}
