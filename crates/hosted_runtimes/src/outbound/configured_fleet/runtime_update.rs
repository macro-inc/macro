//! The host operator calls one fixed executable with a JSON request on stdin.

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::{ConfiguredFleet, ConfiguredFleetError};
use crate::domain::ids::ComputerId;
use crate::domain::ports::GuestProcess;
use crate::domain::runtime_update::{GuestRuntimeUpdate, RuntimeBundle, RuntimeUpdateOutcome};

const EXEC: &str = "/run/current-system/sw/bin/env";
const UPDATER: &str = "/run/current-system/sw/bin/macro-agent-runtime-update";

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
    /// The guest journal still owns recovery.
    #[error("runtime update recovery is still pending in the guest")]
    RecoveryPending,
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
            stdout,
            exit,
        } = fleet
            .exec_as_root(computer, &[EXEC, UPDATER, "submit"])
            .await
            .map_err(ConfiguredFleetError::from)?;
        let request = serde_json::to_vec(bundle)?;
        let write = async move {
            stdin.write_all(&request).await?;
            stdin.shutdown().await?;
            Ok::<_, RuntimeUpdateTransportError>(())
        };
        let read = async move {
            let mut output = String::new();
            stdout.take(16 * 1024).read_to_string(&mut output).await?;
            Ok::<_, RuntimeUpdateTransportError>(output)
        };
        let (_, output, code) = tokio::try_join!(write, read, async {
            exit.await
                .map_err(ConfiguredFleetError::from)
                .map_err(RuntimeUpdateTransportError::from)
        })?;
        self.runtime_update_settled(computer).await?;
        if code == 127 {
            return Ok(RuntimeUpdateOutcome::Refused);
        }
        terminal_outcome(&output, code)
    }

    #[tracing::instrument(name = "computer.runtime_update.status", skip_all, fields(%computer), err)]
    async fn runtime_update_settled(&self, computer: ComputerId) -> Result<(), Self::Err> {
        let Self::Firecracker(fleet) = self else {
            return Ok(());
        };
        let GuestProcess {
            stdin,
            mut stdout,
            exit,
        } = fleet
            .exec_as_root(computer, &[EXEC, UPDATER, "status"])
            .await
            .map_err(ConfiguredFleetError::from)?;
        drop(stdin);
        let (_, status) = tokio::try_join!(
            async {
                tokio::io::copy(&mut stdout, &mut tokio::io::sink())
                    .await
                    .map_err(RuntimeUpdateTransportError::from)
            },
            async {
                exit.await
                    .map_err(ConfiguredFleetError::from)
                    .map_err(RuntimeUpdateTransportError::from)
            },
        )?;
        // The old guest image has no updater and cannot hold a journal.
        if matches!(status, 0 | 127) {
            Ok(())
        } else {
            Err(RuntimeUpdateTransportError::RecoveryPending)
        }
    }
}

fn terminal_outcome(
    output: &str,
    code: i32,
) -> Result<RuntimeUpdateOutcome, RuntimeUpdateTransportError> {
    // systemd-run can return 1 when its worker was killed. Only the
    // worker's terminal record can release a request as refused.
    match output.lines().last() {
        Some("macro-agent-runtime-result=0") => Ok(RuntimeUpdateOutcome::Applied),
        Some("macro-agent-runtime-result=1") => Ok(RuntimeUpdateOutcome::Refused),
        Some("macro-agent-runtime-result=2") => Ok(RuntimeUpdateOutcome::RolledBack),
        Some("macro-agent-runtime-result=3") => Ok(RuntimeUpdateOutcome::RollbackFailed),
        _ => Err(RuntimeUpdateTransportError::Interrupted(code)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_failure_does_not_turn_an_interrupted_runtime_update_into_refusal() {
        assert!(matches!(
            terminal_outcome("restarting agent with bundle\n", 1),
            Err(RuntimeUpdateTransportError::Interrupted(1))
        ));
        assert!(matches!(
            terminal_outcome("macro-agent-runtime-result=1\n", 1),
            Ok(RuntimeUpdateOutcome::Refused)
        ));
    }
}
