//! The fleet effect pass: leasing, running each host's effects in lease
//! order up to its concurrency, and recording their outcomes.

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
    /// Carry out due fleet effects; returns how many ran.
    pub async fn run_fleet_effects(&self) -> Result<usize, ComputerError> {
        self.run_fleet_effects_until(std::future::pending()).await
    }

    /// Stop leasing on shutdown, drain the active effect, then return unfinished leases.
    /// Every effect in the batch shares a deadline measured before leasing, so
    /// queued effects and slow composite fleet calls cannot outlive their lease.
    // Not `err`: the pass reports failures, and skips unavailable storage quietly.
    #[tracing::instrument(skip_all)]
    pub async fn run_fleet_effects_until(
        &self,
        shutdown: impl Future<Output = ()> + Send,
    ) -> Result<usize, ComputerError> {
        let mut shutdown = std::pin::pin!(shutdown);
        let hosts = tokio::select! {
            biased;
            () = &mut shutdown => return Ok(0),
            result = self.driven_hosts() => result?,
        };
        let deadline = tokio::time::Instant::now() + EFFECT_DEADLINE;
        let now = self.clock.now();
        let lease_until = now + EFFECT_LEASE;
        // Never cancel a lease query: the database might commit it after its
        // future is dropped, leaving an untracked lease until expiry.
        let effects = self
            .repo
            .lease_effects(
                EffectWorker::Fleet,
                HostScope::Only(hosts),
                EFFECT_BATCH,
                now,
                lease_until,
            )
            .await
            .map_err(internal)?;
        let ids: Vec<i64> = effects.iter().map(|effect| effect.id).collect();
        let queues = self.start_queues(effects).await?;
        // Set on shutdown or the first failure: effects not yet started stay
        // leased and are returned below.
        let stopping = std::sync::atomic::AtomicBool::new(false);
        let tally = std::sync::Mutex::new(Tally::default());
        // Each host's effects run in lease order, at most its
        // `max_concurrent_starts` at a time.
        let mut workers: futures::stream::FuturesUnordered<_> = queues
            .iter()
            .flat_map(|queue| (0..queue.workers).map(move |_| queue))
            .map(|queue| {
                let stopping = &stopping;
                let tally = &tally;
                async move {
                    while let Some(pending) = queue.next() {
                        if stopping.load(std::sync::atomic::Ordering::Relaxed)
                            || tokio::time::Instant::now() >= deadline
                        {
                            break;
                        }
                        tally
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .count += 1;
                        let work = async {
                            use tracing::Instrument;
                            let computer = self.computer(pending.computer_id).await?;
                            let span = tracing::info_span!("computer.fleet.work", computer_id = %pending.computer_id, team_id = %computer.team_id, size = computer.size.as_ref());
                            crate::domain::telemetry::adopt(&span, &computer.state);
                            self.run_one(pending).instrument(span).await
                        };
                        let result = tokio::time::timeout_at(deadline, work)
                            .await
                            .map_err(internal)
                            .and_then(std::convert::identity);
                        if result.is_err() {
                            stopping.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                        tally
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .record(result);
                    }
                }
            })
            .collect();
        loop {
            use futures::StreamExt;
            tokio::select! {
                // Shutdown first: a worker whose effect just finished must not
                // start its next one once shutdown has come.
                biased;
                () = &mut shutdown => {
                    stopping.store(true, std::sync::atomic::Ordering::Relaxed);
                    tracing::info!("draining computer effects");
                    let drained = tokio::time::timeout(EFFECT_DRAIN, async {
                        while workers.next().await.is_some() {}
                    })
                    .await;
                    if drained.is_err() {
                        tracing::warn!("computer effect drain deadline reached; returning leases");
                    }
                    break;
                }
                worker = workers.next() => if worker.is_none() { break },
            }
        }
        // Drop the effect futures before making their leases available again.
        drop(workers);
        let Tally { count, outcome } = tally
            .into_inner()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.repo
            .release_effects(&ids, lease_until, self.clock.now())
            .await
            .map_err(internal)?;
        outcome?;
        Ok(count)
    }

    /// The leased effects queued per host they address, in lease order, each
    /// worked by its row's `max_concurrent_starts` workers; effects that
    /// address no host share one queue and one worker.
    pub(super) async fn start_queues(
        &self,
        effects: Vec<PendingEffect>,
    ) -> Result<Vec<EffectQueue>, ComputerError> {
        let addressed: std::collections::HashSet<HostId> = effects
            .iter()
            .filter_map(|pending| effect_host(&pending.effect))
            .collect();
        let limits: HashMap<HostId, u32> = if addressed.is_empty() {
            HashMap::new()
        } else {
            self.repo
                .hosts()
                .await
                .map_err(internal)?
                .into_iter()
                .filter(|record| addressed.contains(&record.id))
                .map(|record| (record.id, record.max_concurrent_starts))
                .collect()
        };
        let mut queues: Vec<(Option<HostId>, EffectQueue)> = Vec::new();
        for pending in effects {
            let host = effect_host(&pending.effect);
            let index = match queues.iter().position(|(key, _)| *key == host) {
                Some(index) => index,
                None => {
                    let workers = host
                        .and_then(|host| limits.get(&host).copied())
                        .map_or(1, |limit| usize::try_from(limit).unwrap_or(1));
                    queues.push((
                        host,
                        EffectQueue {
                            workers,
                            pending: std::sync::Mutex::new(std::collections::VecDeque::new()),
                        },
                    ));
                    queues.len() - 1
                }
            };
            queues[index]
                .1
                .pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push_back(pending);
        }
        Ok(queues.into_iter().map(|(_, queue)| queue).collect())
    }

    #[tracing::instrument(
        skip(self, pending),
        fields(effect_id = pending.id, computer_id = %pending.computer_id, attempts = i64::from(pending.attempts), effect, team_id, size, otel.status_code),
        err
    )]
    pub(super) async fn run_one(&self, pending: PendingEffect) -> Result<(), ComputerError> {
        if self
            .repo
            .held(pending.computer_id)
            .await
            .map_err(internal)?
        {
            // Its guest is between hosts; the effect runs on whichever host
            // it is on once the move's cutover or rollback ends.
            tracing::Span::current().record("effect", "held_by_move");
            return self
                .repo
                .postpone_effect(pending.id, self.clock.now() + MOVE_HOLD_RETRY)
                .await
                .map_err(internal);
        }
        let computer = self.computer(pending.computer_id).await?;
        crate::domain::telemetry::resume(computer.state.provision_traceparent.as_deref());
        tracing::Span::current().record("team_id", tracing::field::display(computer.team_id));
        tracing::Span::current().record("size", computer.size.as_ref());
        let phase = serde_json::to_value(&pending.effect).map_err(internal)?;
        let phase = phase
            .get("effect")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        tracing::Span::current().record("effect", phase);
        if pending.attempts == 0 {
            crate::domain::telemetry::record_effect_queued(
                computer.state.provision_traceparent.as_deref(),
                &crate::domain::telemetry::EffectQueued {
                    effect_id: pending.id,
                    computer_id: pending.computer_id.to_string(),
                    phase,
                    queued_at: pending.queued_at,
                    started_at: self.clock.now(),
                },
            );
        }
        let result = tokio::time::timeout(
            FLEET_CALL_TIMEOUT,
            self.carry_out(pending.computer_id, &pending.effect),
        )
        .await
        .map_err(internal)
        .and_then(std::convert::identity);
        match result {
            Ok(follow_up) => {
                if let Some(Event::EffectFailed { reason, .. }) = &follow_up {
                    crate::domain::telemetry::effect_failed(phase);
                    tracing::error!(reason = %reason, "computer effect failed permanently; not retrying");
                }
                self.repo
                    .finish_effect(pending.id, follow_up, self.clock.now())
                    .await
                    .map_err(internal)?;
            }
            // Not the effect's failure: its lease is returned and it runs
            // again on a later pass, without spending an attempt.
            Err(error) if error.is_storage_unavailable() => return Err(error),
            Err(error) if pending.attempts + 1 < MAX_EFFECT_ATTEMPTS => {
                crate::domain::telemetry::effect_failed(phase);
                tracing::warn!(error = ?error, "computer effect failed; retrying");
                let delay = backoff(
                    FLEET_EFFECT_BACKOFF,
                    u8::try_from(pending.attempts).unwrap_or(u8::MAX),
                );
                self.repo
                    .retry_effect(pending.id, error.to_string(), self.clock.now() + delay)
                    .await
                    .map_err(internal)?;
            }
            Err(error) => {
                crate::domain::telemetry::effect_failed(phase);
                tracing::error!(error = ?error, "computer effect failed for good");
                self.repo
                    .finish_effect(
                        pending.id,
                        effect_failure(&pending.effect).map(|failure| Event::EffectFailed {
                            failure,
                            reason: error.to_string(),
                        }),
                        self.clock.now(),
                    )
                    .await
                    .map_err(internal)?;
            }
        }
        Ok(())
    }

    /// Do one effect; returns the event that reports its completion, if any.
    pub(super) async fn carry_out(
        &self,
        computer_id: ComputerId,
        effect: &Effect,
    ) -> Result<Option<Event>, ComputerError> {
        let fleet = match effect_host(effect) {
            Some(host) => Some(self.fleet_for(host).await?),
            None => None,
        };
        let fleet = || {
            fleet.as_deref().ok_or_else(|| {
                ComputerError::Internal(rootcause::report!("a fleet effect names no host"))
            })
        };

        match effect {
            Effect::Create {
                start, generation, ..
            } => {
                // An expired effect lease may have been acquired by another replica.
                // The same guard also fences the harness claim transaction.
                let _guard = self
                    .repo
                    .lock_enrollment(computer_id)
                    .await
                    .map_err(internal)?;
                let computer = self.computer(computer_id).await?;
                if *generation < computer.enrollment_generation {
                    return Ok(None);
                }
                if computer.enrollment_generation != *generation {
                    return Err(ComputerError::Internal(rootcause::report!(
                        "invalid enrollment generation"
                    )));
                }
                let role = match self.repo.agent_of(computer_id).await.map_err(internal)? {
                    Some(_) => crate::domain::enrollment::ComputerRole::Agent,
                    None => crate::domain::enrollment::ComputerRole::Person,
                };
                let enrollment = CreateEnrollment {
                    harnesses: &self.harnesses,
                    deployment: self.deployment.as_ref(),
                    computer: &computer,
                    generation: *generation,
                    role,
                };
                let result = match fleet()?
                    .create(&computer, *generation, &enrollment, *start)
                    .await
                {
                    Ok(image) => {
                        self.repo
                            .record_image(computer_id, &image)
                            .await
                            .map_err(internal)?;
                        Ok(())
                    }
                    Err(error) => Err(error),
                };
                fleet_completion(
                    result,
                    Some(if *start {
                        Event::InstanceStarted
                    } else {
                        Event::InstanceStopped
                    }),
                    Failure::Create,
                )
            }
            Effect::Start { .. } => {
                fleet_completion(fleet()?.start(computer_id).await, None, Failure::Power)
            }
            // Crash recovery must not reboot a guest whose start succeeded
            // before the previous worker lost its completion write.
            Effect::Restart { .. } => {
                fleet_completion(fleet()?.start(computer_id).await, None, Failure::Power)
            }
            Effect::RestartMacrod { .. } => {
                let computer = self.computer(computer_id).await?;
                if computer.state.macrod_connected
                    || computer.state.macrod_misses < crate::domain::lifecycle::MAX_MACROD_MISSES
                    || !matches!(computer.state.phase, Phase::Booting | Phase::Running)
                {
                    return Ok(None);
                }
                fleet_completion(
                    fleet()?.restart_macrod(computer_id).await,
                    None,
                    Failure::Power,
                )
            }
            Effect::Stop { .. } => fleet_completion(
                fleet()?.stop(computer_id).await,
                Some(Event::InstanceStopped),
                Failure::Power,
            ),
            Effect::Destroy { .. } => {
                fleet()?.destroy(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::RevokeHarness => {
                let computer = self.computer(computer_id).await?;
                self.harnesses.revoke(&computer).await.map_err(internal)?;
                Ok(None)
            }
            Effect::DeliverAgent => {
                let computer = self.computer(computer_id).await?;
                // The agent already reported online, or the computer is gone:
                // nothing to hand over.
                if !computer.state.awaiting_agent || !computer.state.is_live() {
                    return Ok(None);
                }
                let Some(harness_id) = computer.harness_id else {
                    return Err(ComputerError::Internal(rootcause::report!(
                        "a connected computer has no harness"
                    )));
                };
                self.harnesses
                    .deliver_agent(harness_id, computer_id, computer.enrollment_generation)
                    .await
                    .map_err(internal)?;
                Ok(Some(Event::AgentDelivered))
            }
            Effect::PageOperator { reason } => {
                // Alerting keys on this event; see the crate's AGENTS.md.
                tracing::error!(computer_id = %computer_id, reason = %reason, "computer needs an operator");
                Ok(None)
            }
            Effect::NotifySetup { outcome } => {
                let computer = self.computer(computer_id).await?;
                // An agent teammate's computer is told about as its agent.
                let agent = self.repo.agent_of(computer_id).await.map_err(internal)?;
                self.notices
                    .send(SetupNotice {
                        computer_id,
                        team_id: computer.team_id,
                        harness_id: computer.harness_id,
                        computer_name: computer.name.as_str().to_owned(),
                        buyer: computer.created_by,
                        agent,
                        outcome: outcome.clone(),
                    })
                    .await
                    .map_err(internal)?;
                Ok(None)
            }
            Effect::RemoveBillingItem { .. }
            | Effect::RefundPurchase { .. }
            | Effect::Charge
            | Effect::SettleCharge { .. }
            | Effect::ScheduleTimer { .. }
            | Effect::UndoAgentInvite => Err(ComputerError::Internal(rootcause::report!(
                "a non-fleet effect reached the fleet worker"
            ))),
        }
    }
}

fn fleet_completion(
    result: Result<(), impl FleetError>,
    completion: Option<Event>,
    failure: Failure,
) -> Result<Option<Event>, ComputerError> {
    match result {
        Ok(()) => Ok(completion),
        Err(error) if error.is_missing() => {
            tracing::warn!("computer instance lost; reprovisioning");
            Ok(Some(Event::InstanceLost))
        }
        // Retrying a request the fleet refused only delays the failure.
        Err(error) if error.is_permanent() => Ok(Some(Event::EffectFailed {
            failure,
            reason: error.to_string(),
        })),
        Err(error) => Err(internal(error)),
    }
}

/// What the team is told when `effect` fails for good. A setup notice that
/// cannot be sent fails nothing: the computer itself is fine.
fn effect_failure(effect: &Effect) -> Option<Failure> {
    match effect {
        Effect::Create { .. } => Some(Failure::Create),
        Effect::Start { .. }
        | Effect::Stop { .. }
        | Effect::Restart { .. }
        | Effect::RestartMacrod { .. }
        | Effect::Destroy { .. }
        | Effect::RevokeHarness
        | Effect::PageOperator { .. }
        | Effect::RemoveBillingItem { .. }
        | Effect::RefundPurchase { .. }
        | Effect::Charge
        | Effect::SettleCharge { .. }
        | Effect::ScheduleTimer { .. } => Some(Failure::Power),
        // The agent's own deadline fails its start, not the hand-off.
        Effect::NotifySetup { .. } | Effect::UndoAgentInvite | Effect::DeliverAgent => None,
    }
}

/// One host's leased effects, in lease order, and how many may run at once.
pub(super) struct EffectQueue {
    workers: usize,
    pending: std::sync::Mutex<std::collections::VecDeque<PendingEffect>>,
}

impl EffectQueue {
    pub(super) fn next(&self) -> Option<PendingEffect> {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pop_front()
    }
}

/// What a pass's effects did: how many started, and its first failure.
struct Tally {
    count: usize,
    outcome: Result<(), ComputerError>,
}

impl Default for Tally {
    fn default() -> Self {
        Self {
            count: 0,
            outcome: Ok(()),
        }
    }
}

impl Tally {
    pub(super) fn record(&mut self, result: Result<(), ComputerError>) {
        if let Err(error) = result
            && self.outcome.is_ok()
        {
            self.outcome = Err(error);
        }
    }
}

fn effect_host(effect: &Effect) -> Option<HostId> {
    match effect {
        Effect::Create { host, .. }
        | Effect::Start { host }
        | Effect::Stop { host }
        | Effect::Restart { host }
        | Effect::RestartMacrod { host }
        | Effect::Destroy { host } => Some(*host),
        Effect::RemoveBillingItem { .. }
        | Effect::RefundPurchase { .. }
        | Effect::Charge
        | Effect::SettleCharge { .. }
        | Effect::RevokeHarness
        | Effect::ScheduleTimer { .. }
        | Effect::PageOperator { .. }
        | Effect::NotifySetup { .. }
        | Effect::DeliverAgent
        | Effect::UndoAgentInvite => None,
    }
}

struct CreateEnrollment<'a, Registry> {
    harnesses: &'a Registry,
    deployment: &'a dyn crate::domain::enrollment::DeploymentSource,
    computer: &'a Computer,
    generation: EnrollmentGeneration,
    role: crate::domain::enrollment::ComputerRole,
}

impl<Registry: Harnesses> FleetEnrollment for CreateEnrollment<'_, Registry> {
    async fn claimed(&self, pairing: PairingId) -> Result<bool, EnrollmentIssueError> {
        self.harnesses
            .pairing_claimed(pairing)
            .await
            .map_err(|_| EnrollmentIssueError)
    }

    #[tracing::instrument(name = "computer.enrollment.issue", skip_all, fields(computer_id = %self.computer.id, generation = i64::from(self.generation.get())), err)]
    async fn issue(&self) -> Result<Enrollment, EnrollmentIssueError> {
        // Resolved per enrollment, so a guest always joins the current addresses.
        let deployment = self
            .deployment
            .deployment()
            .map_err(|_| EnrollmentIssueError)?;
        // Creating a pairing retires the earlier claim secret, so a guest from a
        // lost earlier issuance can no longer claim.
        let pairing = self
            .harnesses
            .create_hosted_pairing(self.computer)
            .await
            .map_err(|_| EnrollmentIssueError)?;
        Ok(Enrollment {
            computer_id: self.computer.id,
            generation: self.generation,
            pairing_id: pairing.pairing_id,
            device_secret: pairing.device_secret,
            name: self.computer.name.clone(),
            deployment,
            traceparent: crate::domain::telemetry::traceparent(),
            role: self.role,
        })
    }
}
