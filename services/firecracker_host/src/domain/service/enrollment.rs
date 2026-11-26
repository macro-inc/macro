//! A computer's enrollment: replaced or removed, and the guest told.

use std::time::Instant;

use firecracker_host_api::{Computer, ComputerId, PowerState, SetEnrollment};

use super::{
    ENROLL_COMMAND, GuestCommand, GuestFailure, HostError, HostProbe, HostService, internal,
};
use crate::domain::metrics::Operation;
use crate::domain::ports::{Disks, Goldens, Machines, Store};

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    /// Replace the enrollment and restart the guest's enrollment.
    pub async fn set_enrollment(
        &self,
        computer_id: ComputerId,
        request: SetEnrollment,
    ) -> Result<Computer, HostError> {
        let started = Instant::now();
        let result = self.set_enrollment_measured(computer_id, request).await;
        self.metrics.operation(
            Operation::SetEnrollment,
            started.elapsed(),
            result.as_ref().map(|_| ()),
        );
        result
    }

    #[tracing::instrument(name = "firecracker_host.set_enrollment", skip(self, request), err)]
    async fn set_enrollment_measured(
        &self,
        computer_id: ComputerId,
        request: SetEnrollment,
    ) -> Result<Computer, HostError> {
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let record = guard.as_mut().ok_or(HostError::NotFound(computer_id))?;
        if record.generation != request.generation {
            return Err(HostError::GenerationMismatch(computer_id));
        }
        self.observe(record).await?;

        record.enrollment = Some(request.enrollment);
        record.pairing_id = request.pairing_id;
        self.save(record).await?;
        if let Some(process) = record.process {
            let document = self.document(record);
            self.machines
                .put_mmds(record, process, &document)
                .await
                .map_err(internal)?;
            if record.state == PowerState::Running {
                let code = self.run_as_root(record, process, &ENROLL_COMMAND).await?;
                if code != 0 {
                    return Err(HostError::GuestUnreachable(GuestFailure::CommandFailed {
                        command: GuestCommand::Enrollment,
                        exit_code: code,
                    }));
                }
            }
        }
        Ok(self.view(record))
    }

    /// Remove the enrollment; absent computers are fine.
    pub async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), HostError> {
        let started = Instant::now();
        let result = self.clear_enrollment_measured(computer_id).await;
        self.metrics.operation(
            Operation::ClearEnrollment,
            started.elapsed(),
            result.as_ref().map(|_| ()),
        );
        result
    }

    #[tracing::instrument(name = "firecracker_host.clear_enrollment", skip(self), err)]
    async fn clear_enrollment_measured(&self, computer_id: ComputerId) -> Result<(), HostError> {
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let Some(record) = guard.as_mut() else {
            return Ok(());
        };
        self.observe(record).await?;
        if record.enrollment.is_none() {
            return Ok(());
        }
        record.enrollment = None;
        self.save(record).await?;
        if let Some(process) = record.process {
            let document = self.document(record);
            self.machines
                .put_mmds(record, process, &document)
                .await
                .map_err(internal)?;
        }
        Ok(())
    }
}
