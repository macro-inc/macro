//! The host operator calls one fixed executable with a JSON request on stdin.

use tokio::io::AsyncWriteExt;

use super::{ConfiguredFleet, ConfiguredFleetError};
use crate::domain::ids::ComputerId;
use crate::domain::ports::GuestProcess;
use crate::domain::runtime_update::{GuestRuntimeUpdate, RuntimeBundle, RuntimeUpdateOutcome};

/// A transport failure whose guest outcome is unknown.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeUpdateTransportError {
    /// The host could not run the command or report how it ended.
    #[error(transparent)]
    Fleet(#[from] ConfiguredFleetError),
    /// Sending the request or receiving the result failed.
    #[error("runtime updater I/O failed")]
    Io(#[from] std::io::Error),
    /// The typed request could not be encoded.
    #[error("runtime update request could not be encoded")]
    Request(#[from] serde_json::Error),
    /// The guest did not report a normal terminal code.
    #[error("runtime updater was interrupted (exit {0})")]
    Interrupted(i32),
}

impl GuestRuntimeUpdate for ConfiguredFleet {
    type Err = RuntimeUpdateTransportError;

    #[tracing::instrument(name = "computer.runtime_update.guest", skip_all, fields(%computer), err)]
    async fn update_guest_runtime(
        &self,
        computer: ComputerId,
        bundle: &RuntimeBundle,
    ) -> Result<RuntimeUpdateOutcome, Self::Err> {
        let Self::Firecracker(fleet) = self else {
            return Ok(RuntimeUpdateOutcome::Refused);
        };
        let GuestProcess {
            mut stdin,
            mut stdout,
            exit,
        } = fleet
            .exec_as_root(
                computer,
                &[
                    "/run/current-system/sw/bin/macro-agent-runtime-update",
                    "submit",
                ],
            )
            .await
            .map_err(ConfiguredFleetError::from)?;
        let request = serde_json::to_vec(bundle)?;
        let write = async move {
            stdin.write_all(&request).await?;
            stdin.shutdown().await?;
            Ok::<_, RuntimeUpdateTransportError>(())
        };
        let read = async move {
            tokio::io::copy(&mut stdout, &mut tokio::io::sink()).await?;
            Ok::<_, RuntimeUpdateTransportError>(())
        };
        let (_, _, code) = tokio::try_join!(write, read, async {
            exit.await
                .map_err(ConfiguredFleetError::from)
                .map_err(RuntimeUpdateTransportError::from)
        })?;
        Ok(match code {
            0 => RuntimeUpdateOutcome::Applied,
            2 => RuntimeUpdateOutcome::RolledBack,
            3 => RuntimeUpdateOutcome::RollbackFailed,
            1 | 127 => RuntimeUpdateOutcome::Refused,
            interrupted => return Err(RuntimeUpdateTransportError::Interrupted(interrupted)),
        })
    }
}
