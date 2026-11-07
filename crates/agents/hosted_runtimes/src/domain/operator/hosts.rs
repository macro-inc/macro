//! The hosts an operator drives: registering the home host, finding the
//! fleet for a host, and reconciling each host's fleet with the rows.

use super::*;

impl<Repo, Machines, Registry, Time, SetupNotifier>
    ComputerOperator<Repo, Machines, Registry, Time, SetupNotifier>
where
    Repo: ComputerRepo
        + crate::domain::agent::ComputerAgents
        + crate::domain::ports::OvercommitRepo
        + crate::domain::moves::ComputerMoves,
    Machines: Fleets,
    Registry: Harnesses,
    Time: Clock,
    SetupNotifier: SetupNotices,
{
    /// The home host, registered from its fleet on first use (retried with
    /// backoff); `None` when this control plane has no home host and drives
    /// only host rows.
    pub(super) async fn home_host(&self) -> Result<Option<HostId>, ComputerError> {
        let Some(home) = self.fleet.home() else {
            return Ok(None);
        };
        let mut readiness = self.host.lock().await;
        if let Some(id) = readiness.id {
            return Ok(Some(id));
        }
        let now = self.clock.now();
        if readiness.retry_at.is_some_and(|at| now < at) {
            return Err(ComputerError::Internal(rootcause::report!(
                "computer host unhealthy; waiting to retry registration"
            )));
        }
        let registration = async {
            let registration = home.host().await.map_err(internal)?;
            self.repo
                .register_host(registration)
                .await
                .map_err(internal)
        }
        .await;
        match registration {
            Ok(host) => {
                self.repo
                    .postpone_macrod_timers(host.id, self.clock.now() + MACROD_GRACE)
                    .await
                    .map_err(internal)?;
                tracing::info!(host_id = %host.id, host = %host.name, healthy = true,
                    awake_units = host.awake_capacity_units, sold_units = host.sold_capacity_units,
                    "computer host registered");
                readiness.id = Some(host.id);
                readiness.retry_at = None;
                Ok(Some(host.id))
            }
            Err(error) => {
                let delay = backoff(HOST_REGISTRATION_BACKOFF, readiness.failures);
                let retry_seconds = delay.num_seconds();
                readiness.failures = readiness.failures.saturating_add(1);
                readiness.retry_at = Some(self.clock.now() + delay);
                if error.is_storage_unavailable() {
                    tracing::warn!(
                        retry_seconds,
                        "computer storage unavailable; retrying host registration"
                    );
                } else {
                    tracing::error!(error = ?error, healthy = false, retry_seconds,
                        "computer host unavailable; retrying registration");
                }
                Err(error)
            }
        }
    }

    /// The fleet driving `host`: the home fleet, or the one its row names.
    pub(super) async fn fleet_for(
        &self,
        host: HostId,
    ) -> Result<FleetHandle<'_, Machines::Fleet>, ComputerError> {
        if let Some(home) = self.fleet.home()
            && self.home_host().await? == Some(host)
        {
            return Ok(FleetHandle::Home(home));
        }
        let record = self
            .repo
            .hosts()
            .await
            .map_err(internal)?
            .into_iter()
            .find(|record| record.id == host)
            .ok_or_else(|| ComputerError::Internal(rootcause::report!("host {host} has no row")))?;
        self.fleet.fleet(&record).map_err(internal)
    }

    /// The home host, if any, and every host row this control plane drives.
    pub(super) async fn driven_hosts(&self) -> Result<Vec<HostId>, ComputerError> {
        let home = self.home_host().await?;
        let mut hosts: Vec<HostId> = self
            .repo
            .hosts()
            .await
            .map_err(internal)?
            .into_iter()
            .filter(|record| Some(record.id) != home && self.fleet.drives(record))
            .map(|record| record.id)
            .collect();
        hosts.extend(home);
        Ok(hosts)
    }

    /// The fleet running `computer_id`, for running programs in its guest.
    pub async fn fleet_of(
        &self,
        computer_id: ComputerId,
    ) -> Result<FleetHandle<'_, Machines::Fleet>, ComputerError> {
        let computer = self.computer(computer_id).await?;
        self.fleet_for(computer.host).await
    }

    /// Compare each host's fleet with the rows: a missing or stopped instance of an
    /// awake computer is a crash; a missing stopped or failed guest is recreated.
    /// Only owned orphans older than the grace period are removed. Each pass
    /// also gauges the fleet's allocation (`computer.capacity.*`) and
    /// refreshes every driven host row's registration (its heartbeat); one
    /// unreachable host skips only itself.
    // Not `err`: the pass reports failures, and skips unavailable storage quietly.
    #[tracing::instrument(skip(self))]
    pub async fn reconcile(&self) -> Result<(), ComputerError> {
        let home = self.home_host().await?;
        if let Some(home) = home {
            self.repo
                .heartbeat_host(home, self.clock.now())
                .await
                .map_err(internal)?;
        }
        // Before fleet calls, so an unreachable host still reports what it holds.
        match self.repo.allocation().await {
            Ok(allocations) => crate::domain::telemetry::record_capacity(&allocations),
            Err(error) => tracing::warn!(error = ?error, "could not read computer capacity"),
        }
        let hosts = self.repo.hosts().await.map_err(internal)?;
        for record in hosts
            .iter()
            .filter(|record| Some(record.id) != home && self.fleet.drives(record))
        {
            use tracing::Instrument;
            let span = tracing::info_span!("computer.reconcile.host", host_id = %record.id, host = %record.name);
            self.reconcile_other(record)
                .instrument(span)
                .await
                .inspect_err(|error| {
                    tracing::error!(host_id = %record.id, host = %record.name, error = ?error, healthy = false, "computer host unavailable");
                })
                .ok();
        }
        match (home, self.fleet.home()) {
            (Some(home), Some(fleet)) => self.reconcile_instances(home, fleet).await,
            _ => Ok(()),
        }
    }

    /// Refresh a host row's registration through its own fleet, then reconcile it.
    pub(super) async fn reconcile_other(&self, record: &HostRecord) -> Result<(), ComputerError> {
        let fleet = self.fleet.fleet(record).map_err(internal)?;
        let registration = fleet.host().await.map_err(internal)?;
        if registration.name != record.name {
            return Err(ComputerError::Internal(rootcause::report!(
                "host {} registered as {}",
                record.name,
                registration.name
            )));
        }
        self.repo
            .register_host(registration)
            .await
            .map_err(internal)?;
        self.reconcile_instances(record.id, &fleet).await
    }

    pub(super) async fn reconcile_instances(
        &self,
        host: HostId,
        fleet: &Machines::Fleet,
    ) -> Result<(), ComputerError> {
        let instances: HashMap<ComputerId, FleetInstance> = fleet
            .instances()
            .await
            .map_err(internal)?
            .into_iter()
            .filter(|instance| &instance.control_plane_id == fleet.control_plane_id())
            .map(|instance| (instance.computer_id, instance))
            .collect();
        let expected = self.repo.instances_expected(host).await.map_err(internal)?;
        // Stopped and staged while a move copies its last changes: neither
        // crashed nor lost.
        let held = self.repo.held_on(host).await.map_err(internal)?;

        for record in &expected {
            let Some(computer) = record.healthy() else {
                continue;
            };
            if held.contains(&computer.id) {
                continue;
            }
            let observed = instances.get(&computer.id).map(|instance| instance.status);
            if observed.is_some() {
                match fleet.resources_match(computer).await {
                    Ok(true) => {}
                    Ok(false) => {
                        tracing::error!(computer_id = %computer.id, resources = ?computer.resources, reason = "resource limits drifted", "computer needs an operator")
                    }
                    Err(error) => {
                        tracing::warn!(computer_id = %computer.id, error = ?error, "could not check computer resource limits")
                    }
                }
            }
            let crashed = match computer.state.phase {
                Phase::Running | Phase::Booting => {
                    observed.is_none() || observed == Some(InstanceStatus::Stopped)
                }
                Phase::Provisioning { .. }
                | Phase::Crashed { .. }
                | Phase::Stopping
                | Phase::Stopped
                | Phase::Destroying => false,
            };
            let lost = observed.is_none()
                && matches!(
                    computer.state.phase,
                    Phase::Crashed { retry: None, .. } | Phase::Stopped
                );
            if crashed || lost {
                use tracing::Instrument;
                let span = tracing::info_span!("computer.reconcile.drift", computer_id = %computer.id, lost);
                crate::domain::telemetry::adopt(&span, &computer.state);
                async {
                    tracing::warn!(computer_id = %computer.id, observed = ?observed, "computer instance drifted");
                    self.repo
                        .apply(
                            computer.id,
                            if lost {
                                Event::InstanceLost
                            } else {
                                Event::VmCrashed
                            },
                            self.clock.now(),
                        )
                        .await
                        .map_err(internal)
                }
                .instrument(span)
                .await?;
            }
        }

        for (orphan, instance) in &instances {
            if instance
                .created_at
                .is_none_or(|at| at >= self.clock.now() - ORPHAN_GRACE)
            {
                continue;
            }
            let known = expected.iter().any(|computer| computer.id() == *orphan);
            if !known
                && self
                    .repo
                    .get(*orphan)
                    .await
                    .map_err(internal)?
                    .is_none_or(is_gone)
            {
                tracing::warn!(computer_id = %orphan, host_id = %host, control_plane_id = fleet.control_plane_id().as_str(), "destroying an instance with no computer");
                fleet.destroy(*orphan).await.map_err(internal)?;
            }
        }
        Ok(())
    }
}

fn is_gone(record: ComputerRecord) -> bool {
    record
        .healthy()
        .is_some_and(|computer| !computer.state.is_live())
}
