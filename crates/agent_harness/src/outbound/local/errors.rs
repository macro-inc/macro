//! Failures the local Docker provider can produce.

use thiserror::Error;

/// Something went wrong driving the local container runtime.
#[derive(Debug, Error)]
pub enum LocalError {
    /// The `docker` binary could not be run at all.
    #[error("could not run `{binary}`: {source}")]
    Spawn {
        /// The binary we tried to run.
        binary: String,
        /// Why it could not be run.
        #[source]
        source: std::io::Error,
    },

    /// Docker ran and refused.
    #[error("`docker {command}` failed with status {status}: {stderr}")]
    Command {
        /// The subcommand, for a message that says which step broke.
        command: String,
        /// Exit status docker reported.
        status: i32,
        /// Whatever docker said about it.
        stderr: String,
    },

    /// A command in a container outlived its timeout.
    #[error("`docker exec` in {container} did not finish within {seconds}s")]
    ExecTimeout {
        /// Container the command was running in.
        container: String,
        /// How long it was given.
        seconds: u64,
    },

    /// The readiness recipe ran and failed inside the container.
    #[error("readiness recipe failed in {container} with status {status}: {output}")]
    ReadinessRecipe {
        /// Container the recipe ran in.
        container: String,
        /// Exit status of the recipe.
        status: i32,
        /// Combined output, for the person reading the log.
        output: String,
    },

    /// The sandbox image is not on the daemon.
    #[error(
        "sandbox image `{image}` is missing; build it with `just -f crates/agent_harness/justfile build-local`"
    )]
    ImageMissing {
        /// Image the local provider was configured to run.
        image: String,
    },

    /// The sidecar never answered its readiness probe.
    #[error("sidecar in {container} was not ready within {seconds}s")]
    NotReady {
        /// Container whose sidecar stayed silent.
        container: String,
        /// How long we waited.
        seconds: u64,
    },

    /// The sidecar socket could not be dialed.
    #[error("could not dial the sidecar at {url}: {source}")]
    WebSocketConnect {
        /// Address we dialed.
        url: String,
        /// Why the dial failed.
        #[source]
        source: tokio_tungstenite::tungstenite::Error,
    },
}
