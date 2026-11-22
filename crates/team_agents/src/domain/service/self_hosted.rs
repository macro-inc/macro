//! The service's half for agents on their owners' own machines: invite,
//! move, removal and credential issuance for installs.

use futures::StreamExt;

use super::*;

/// Installs offboarded per sweep round.
const OFFBOARD_PAGE: u32 = 100;

/// Installs a round offboards at once, each revoke with its own
/// [`REVOKE_TIMEOUT`], so one that hangs holds up only its own slot.
const OFFBOARD_CONCURRENCY: usize = 4;

/// How long one agent's pending revoke may take (its keys, then a
/// repository token from agent_git) while it holds the install's row lock.
/// Past it the revoke gives up: its transaction rolls back, `revoke_pending`
/// stays set, nothing is delivered meanwhile, and the next sweep retries.
/// Per agent, and well under the 10 s an unpair's call to
/// `POST /internal/teammate_hosts/{harness_id}/offboard` waits
/// (document_storage_service's `teammate_host_offboarding::TIMEOUT`), which
/// also only runs after every agent on the machine is parked.
const REVOKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// A pending revoke took longer than [`REVOKE_TIMEOUT`].
#[derive(Debug, thiserror::Error)]
#[error("revoking an agent's credentials took longer than {REVOKE_TIMEOUT:?}; left pending")]
struct RevokeTimedOut;
use crate::domain::models::InstallProblem;
use crate::domain::self_hosting::InstallRunState;

/// An issuance step failed; the cause is logged, never returned.
fn issuance_failed(step: &'static str) -> impl FnOnce(TeamAgentError) -> AgentEnrollmentError {
    move |error| {
        tracing::error!(error = ?error, step, "could not issue an install's credentials");
        AgentEnrollmentError::IssuanceFailed
    }
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Installs, Runtimes>
    TeamAgentServiceImpl<
        Repository,
        Membership,
        ApiKeys,
        Repos,
        Computer,
        Creators,
        Flags,
        Notices,
        Installs,
        Runtimes,
    >
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Notices: AgentReadyNotices,
    Creators: agent_credentials::AgentCreators + 'static,
    Flags: FeatureFlags + 'static,
    Installs: TeammateInstalls,
    Runtimes: TeammateRuntimes,
{
    /// The self-hosted rollout for `caller`, on top of agent teammates'.
    /// Fails closed.
    pub(super) async fn ensure_self_hosting(
        &self,
        caller: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        if flag_on(self.flags.as_ref(), caller, SELF_HOSTED_TEAMMATES_FLAG).await {
            Ok(())
        } else {
            Err(TeamAgentError::SelfHostedNotEnabled)
        }
    }

    /// Refuse unless `owner` may host an agent on `harness` now: the
    /// self-hosted rollout, their own machine (never a Macro computer), and
    /// eligible.
    pub(super) async fn require_own_host(
        &self,
        owner: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<(), TeamAgentError> {
        self.ensure_self_hosting(owner).await?;
        let host = self
            .installs
            .hosts_of(owner)
            .await?
            .into_iter()
            .find(|host| host.harness_id == harness)
            // Someone else's machine looks the same as no machine.
            .ok_or(TeamAgentError::NotFound)?;
        let eligibility = HostEligibility::of(host.connected, host.report.as_ref(), &*self.images);
        if eligibility.ok {
            Ok(())
        } else {
            Err(TeamAgentError::HostNotEligible(eligibility))
        }
    }

    /// The last step of an own-machine invite: the agent's install,
    /// generation 1, then tell the machine. Undoes the invite if the install
    /// can't be made.
    pub(super) async fn install_invited(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        undo: Undo,
        harness: HarnessId,
        agent: MacroUserIdStr<'static>,
        seed: PersonaSeed,
        created_by: MacroUserIdStr<'static>,
    ) -> Result<TeamAgent, TeamAgentError> {
        let team_id = team_id(&receipt)?;
        let new_install = NewTeammateInstall {
            install_id: Uuid::now_v7(),
            agent: agent.clone(),
            team_id,
            harness_id: harness,
            created_by: created_by.clone(),
        };
        let install = match self.installs.create(&new_install).await {
            // The account is new, so nobody else can have installed it.
            Ok(CreatedInstall::Created(install) | CreatedInstall::AlreadyInstalled(install)) => {
                install
            }
            Err(error) => {
                self.undo(receipt, undo).await;
                return Err(error);
            }
        };
        tracing::info!(install_id = %install.install_id, %harness, "installed an agent teammate on its owner's machine");
        self.runtimes.installs_changed(harness).await;

        Ok(TeamAgent {
            user_id: agent,
            team_id,
            name: seed.name,
            job_description: seed.job_description,
            personality: seed.personality,
            created_by: Some(created_by),
            computer_id: None,
            harness_id: Some(harness),
            status: TeamAgentStatus::Provisioning,
            install_problem: None,
            moving_to: None,
            created_at: chrono::Utc::now(),
        })
    }

    /// An agent on its owner's own machine, as listed.
    pub(super) fn installed_agent(
        record: TeamAgentRecord,
        install: &TeammateInstallRecord,
    ) -> TeamAgent {
        let status = match install.checkpoint {
            Some((Checkpoint::Moving { .. }, _)) => TeamAgentStatus::Moving,
            Some((Checkpoint::Removing, _)) => TeamAgentStatus::Paused,
            None if install.parked() => TeamAgentStatus::Paused,
            None => {
                TeamAgentStatus::of_install(install.run_state, record.first_online_at.is_some())
            }
        };
        TeamAgent {
            user_id: record.user_id,
            team_id: record.team_id,
            name: record.persona_seed.name,
            job_description: record.persona_seed.job_description,
            personality: record.persona_seed.personality,
            created_by: record.created_by,
            computer_id: None,
            harness_id: Some(install.harness_id),
            status,
            install_problem: install_problem(install),
            moving_to: match install.checkpoint {
                Some((Checkpoint::Moving { to }, _)) => Some(to),
                _ => None,
            },
            created_at: record.created_at,
        }
    }

    /// After a checkpoint began: finish at once when the agent is parked
    /// (it runs nowhere), the old machine is offline (it can't push anything
    /// more) or the wait already timed out; otherwise ask the replica holding its socket to stop it, which
    /// finishes the checkpoint when the machine reports it stopped.
    async fn checkpoint_began(
        &self,
        install: &TeammateInstallRecord,
    ) -> Result<(), TeamAgentError> {
        let connected = self
            .installs
            .host(install.harness_id)
            .await?
            .is_some_and(|host| host.connected);
        let timed_out = install.checkpoint.is_some_and(|(_, since)| {
            chrono::Utc::now().signed_duration_since(since)
                >= chrono::Duration::from_std(CHECKPOINT_TIMEOUT).unwrap_or(chrono::Duration::MAX)
        });
        if install.parked() || !connected || timed_out {
            return self.finish_installed_checkpoint(install.install_id).await;
        }
        self.runtimes.installs_changed(install.harness_id).await;
        Ok(())
    }

    /// Offboarding over this service's ports.
    pub(super) fn offboarding(
        &self,
    ) -> Offboarding<'_, Repository, ApiKeys, Repos, Installs, Runtimes> {
        Offboarding {
            repository: &self.repository,
            api_keys: &self.api_keys,
            repos: &self.repos,
            installs: &self.installs,
            runtimes: &self.runtimes,
        }
    }

    /// See [`Offboarding::offboard`].
    pub(super) async fn offboard(
        &self,
        install: &TeammateInstallRecord,
    ) -> Result<(), TeamAgentError> {
        self.offboarding().offboard(install).await
    }

    async fn finish_revoke(&self, install: &TeammateInstallRecord) -> Result<(), TeamAgentError> {
        self.offboarding().finish_revoke(install).await
    }

    /// See [`Offboarding::offboard_unentitled`].
    pub(super) async fn offboard_unentitled(&self) -> Result<(usize, usize), TeamAgentError> {
        self.offboarding().offboard_unentitled().await
    }

    /// Start removing an agent on its owner's own machine.
    pub(super) async fn remove_installed(
        &self,
        record: &TeamAgentRecord,
    ) -> Result<(), TeamAgentError> {
        let Some(install) = self
            .installs
            .begin_checkpoint(&record.user_id, Checkpoint::Removing)
            .await?
        else {
            return Ok(());
        };
        self.checkpoint_began(&install).await
    }

    /// Start moving an agent to another of the admin's own machines.
    pub(super) async fn move_installed(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
        harness: HarnessId,
    ) -> Result<TeamAgent, TeamAgentError> {
        let caller = acting_user(&receipt)?;
        self.ensure_enabled(&caller).await?;
        let record = self.team_record(&receipt, agent).await?;
        let current = self
            .installs
            .for_agent(&record.user_id)
            .await?
            .ok_or(TeamAgentError::NotSelfHosted)?;
        if matches!(current.checkpoint, Some((Checkpoint::Removing, _))) {
            return Err(TeamAgentError::NotFound);
        }
        // Already there, running, and not leaving: nothing to do.
        if current.harness_id == harness && current.checkpoint.is_none() && !current.parked() {
            return Ok(Self::installed_agent(record, &current));
        }
        // Whoever runs the agent's machine could act as the agent, so only
        // its inviter or that machine's owner may send it somewhere else. A
        // parked agent's new machine gets its key, DMs and shares, and any
        // admin could park it by removing its host, so only its inviter, the
        // team's owner, or its machine's owner once that machine may host it
        // again.
        let invited_it = record.created_by.as_ref() == Some(&caller);
        let hosts_it = || async {
            Ok::<_, TeamAgentError>(
                self.installs
                    .hosts_of(&caller)
                    .await?
                    .iter()
                    .any(|host| host.harness_id == current.harness_id),
            )
        };
        let allowed = if invited_it {
            true
        } else if current.parked() {
            self.installs.owns_team(record.team_id, &caller).await?
                || (hosts_it().await?
                    && self
                        .installs
                        .host_entitled(current.harness_id, record.team_id)
                        .await?)
        } else {
            hosts_it().await?
        };
        if !allowed {
            return Err(TeamAgentError::Forbidden(
                "only the agent's inviter, the team's owner or its machine's owner can move it",
            ));
        }
        self.require_own_host(&caller, harness).await?;

        let install = self
            .installs
            .begin_checkpoint(&record.user_id, Checkpoint::Moving { to: harness })
            .await?
            .ok_or(TeamAgentError::NotSelfHosted)?;
        tracing::info!(install_id = %install.install_id, "moving an agent teammate to another machine");
        self.checkpoint_began(&install).await?;

        let install = self
            .installs
            .for_agent(&record.user_id)
            .await?
            .ok_or(TeamAgentError::NotSelfHosted)?;
        Ok(Self::installed_agent(record, &install))
    }

    /// Finish a move or removal once the old machine stopped the agent, or
    /// the wait gave up.
    pub(super) async fn finish_installed_checkpoint(
        &self,
        install_id: Uuid,
    ) -> Result<(), TeamAgentError> {
        let Some(install) = self.installs.by_id(install_id).await? else {
            return Ok(());
        };
        match install.checkpoint {
            None => Ok(()),
            Some((Checkpoint::Moving { to }, _)) => {
                // A new install id per machine: a move back never reuses a
                // stale volume. The old machine's credentials die here, not
                // at the new machine's first delivery, which may never come.
                // The finished move marks them due for revoking, and nothing
                // is delivered until they are, so a revoke never voids what
                // the new machine is given; a failed one is retried by the
                // offboarding sweep.
                if let Some(moved) = self
                    .installs
                    .finish_move(install_id, Uuid::now_v7())
                    .await?
                {
                    tracing::info!(
                        previous_install_id = %install_id,
                        install_id = %moved.install_id,
                        generation = moved.generation,
                        target = %to,
                        "an agent teammate moved to another machine"
                    );
                    self.finish_revoke(&moved).await?;
                }
                Ok(())
            }
            Some((Checkpoint::Removing, _)) => self.finish_removal(&install).await,
        }
    }

    /// Void every credential the agent's machine holds: its API keys, and
    /// its repository token, by issuing a fresh one nobody receives.
    async fn revoke_credentials(&self, agent: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        revoke_credentials(&self.repository, &self.api_keys, &self.repos, agent).await
    }

    /// Remove the agent as removing one on a Macro computer does, with its
    /// install, which its seat's removal deletes, last. Each step is
    /// idempotent, so a retry finishes.
    async fn finish_removal(&self, install: &TeammateInstallRecord) -> Result<(), TeamAgentError> {
        let Some(record) = self
            .repository
            .get(&install.agent)
            .await
            .map_err(TeamAgentError::internal)?
        else {
            return Ok(());
        };
        self.revoke_credentials(&record.user_id).await?;
        let removed_by = record
            .created_by
            .clone()
            .unwrap_or_else(|| record.user_id.clone());
        self.membership
            .take_back_agent(record.team_id, &record.user_id, removed_by)
            .await?;
        self.repository
            .remove_seat(&record.user_id)
            .await
            .map_err(TeamAgentError::internal)?;
        tracing::info!(install_id = %install.install_id, "removed an agent teammate from its owner's machine");
        Ok(())
    }

    /// Count and issue the next delivery of an install's credentials.
    /// Fresh credentials for an installed agent: a new key (revoking the
    /// last), a repository token and the public addresses.
    async fn mint_installed(
        &self,
        agent: &MacroUserIdStr<'_>,
        record: &TeamAgentRecord,
        install_id: Uuid,
    ) -> Result<AgentEnv, AgentEnrollmentError> {
        let api_key = self
            .api_keys
            .mint(agent)
            .await
            .map_err(issuance_failed("mint the agent's key"))?;
        let repo = self
            .repos
            .create(agent, record.team_id, &record.persona_seed)
            .await
            .map_err(issuance_failed("issue the repository token"))?;
        let addresses = self
            .public_environment
            .environment()
            .map_err(issuance_failed("resolve the public addresses"))?;
        agent_env(
            addresses,
            &api_key,
            agent,
            record,
            repo,
            Placement::Install(install_id),
        )
    }

    pub(super) async fn issue_installed(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        reported: Option<(u64, u64)>,
    ) -> Result<Option<IssuedInstall>, AgentEnrollmentError> {
        let Some(install) = self
            .installs
            .by_id(install_id)
            .await
            .map_err(issuance_failed("read the install"))?
        else {
            return Ok(None);
        };
        tracing::Span::current().record(
            "agent_user_id",
            tracing::field::display(agent_credentials::telemetry_id(install.agent.as_ref())),
        );
        if install.harness_id != harness || install.checkpoint.is_some() || install.parked() {
            tracing::info!(
                pending_checkpoint = install.checkpoint.is_some(),
                parked = install.parked(),
                "the install isn't to run on this machine now; nothing to issue"
            );
            return Ok(None);
        }
        // A machine whose owner left the team, lost admin or unpaired it gets
        // nothing more, and the agent is parked off it.
        let entitled = self
            .installs
            .host_entitled(harness, install.team_id)
            .await
            .map_err(issuance_failed("check the machine's owner"))?;
        if !entitled {
            tracing::warn!("the machine may no longer host this agent; taking it off");
            self.offboard(&install)
                .await
                .map_err(issuance_failed("take the agent off the machine"))?;
            return Ok(None);
        }

        let record = self
            .repository
            .get(&install.agent)
            .await
            .map_err(|error| issuance_failed("read the agent")(TeamAgentError::internal(error)))?
            .ok_or(AgentEnrollmentError::NotFound)?;

        // Both rollouts, on the admin who invited the agent (PostHog never
        // targets the agent's own account). Off, nothing is issued.
        let Some(creator) = record.created_by.clone() else {
            tracing::warn!("the agent has no inviter to follow; nothing issued");
            return Ok(None);
        };
        let flags = self.flags.as_ref();
        let enabled = flag_on(flags, &creator, AGENT_TEAMMATES_FLAG).await
            && flag_on(flags, &creator, SELF_HOSTED_TEAMMATES_FLAG).await;
        if !enabled {
            tracing::warn!(
                "self-hosted teammates are off for this agent's inviter; nothing issued"
            );
            return Ok(None);
        }

        let image = self
            .installs
            .host(harness)
            .await
            .map_err(issuance_failed("read the machine"))?
            .and_then(|host| host.report)
            .and_then(|report| (self.images)(report.arch));
        let Some(image) = image else {
            tracing::warn!("no teammate runtime image for this machine; nothing issued");
            return Ok(None);
        };

        // The count holds the row until released, so racing replicas mint
        // in delivery order and the machine's highest pair is the live key.
        let Some(counted) = self
            .installs
            .next_delivery(
                install_id,
                harness,
                reported.unwrap_or((0, 0)),
                &image.image_id,
            )
            .await
            .map_err(issuance_failed("count the delivery"))?
        else {
            tracing::info!("the machine already runs the latest delivery; nothing issued");
            return Ok(None);
        };
        let (generation, delivery) = counted.pair();
        let env = self
            .mint_installed(&install.agent, &record, install_id)
            .await;
        // Kept even when minting failed: the machine is then behind the row
        // and gets the next delivery when it reports again.
        counted
            .release()
            .await
            .map_err(issuance_failed("keep the delivery count"))?;
        let env = env?;
        tracing::info!(generation, delivery, "issued an install's credentials");
        Ok(Some(IssuedInstall {
            generation,
            delivery,
            image,
            env,
        }))
    }
}

/// Taking agents off machines that may no longer host them, over borrowed
/// ports, so the agent service and [`super::InstallOffboarding`] (which team
/// deletion and membership changes hold) share it.
pub(super) struct Offboarding<'a, Repository, ApiKeys, Repos, Installs, Runtimes> {
    pub(super) repository: &'a Repository,
    pub(super) api_keys: &'a ApiKeys,
    pub(super) repos: &'a Repos,
    pub(super) installs: &'a Installs,
    pub(super) runtimes: &'a Runtimes,
}

impl<Repository, ApiKeys, Repos, Installs, Runtimes>
    Offboarding<'_, Repository, ApiKeys, Repos, Installs, Runtimes>
where
    Repository: TeamAgentRepository,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Installs: TeammateInstalls,
    Runtimes: TeammateRuntimes,
{
    /// Take an agent off a machine that may no longer host it: park it
    /// (stopped there, its account, seat and repository kept, for an admin
    /// to move to a machine of theirs), then void its credentials. Parking
    /// first waits for a delivery in flight and stops any later one, so the
    /// revoke voids every key the machine was given.
    pub(super) async fn offboard(
        &self,
        install: &TeammateInstallRecord,
    ) -> Result<(), TeamAgentError> {
        let Some(parked) = self.installs.park(&install.agent).await? else {
            return Ok(());
        };
        tracing::info!(install_id = %parked.install_id, "parking an agent teammate off a machine that may no longer host it");
        // The machine stops it as no longer its own.
        self.runtimes.installs_changed(parked.harness_id).await;
        self.finish_revoke(&parked).await
    }

    /// Revoke an install's pending credentials, then let deliveries resume
    /// (nudging its machine, unless it is parked). The revoke runs under the
    /// install's row lock and only while the flag is still set, so a caller
    /// holding a stale copy (a sweep that listed it before another revoke
    /// finished) can't void the key a machine was given since.
    pub(super) async fn finish_revoke(
        &self,
        install: &TeammateInstallRecord,
    ) -> Result<(), TeamAgentError> {
        let Some(held) = self.installs.begin_revoke(&install.agent).await? else {
            return Ok(());
        };
        let current = held.install().clone();
        // Bounded: other writers to this install wait on the lock meanwhile.
        tokio::time::timeout(
            REVOKE_TIMEOUT,
            revoke_credentials(self.repository, self.api_keys, self.repos, &current.agent),
        )
        .await
        .map_err(|_elapsed| TeamAgentError::internal(RevokeTimedOut))??;
        held.done().await?;
        if !current.parked() {
            self.runtimes.installs_changed(current.harness_id).await;
        }
        Ok(())
    }

    /// Offboard the installs on (or moving to) `harness` that it may no
    /// longer host; one failure doesn't stop the rest. How many.
    pub(super) async fn offboard_host(&self, harness: HarnessId) -> Result<usize, TeamAgentError> {
        let installs = self
            .installs
            .unentitled_installs_on(harness, OFFBOARD_PAGE)
            .await?;
        // Park them all first: parking is one write each, so a slow revoke
        // (bounded per agent) never keeps the machine's other agents
        // running, even if the caller gives up meanwhile.
        let mut parked = Vec::new();
        for install in &installs {
            match self.installs.park(&install.agent).await {
                Ok(Some(install)) => parked.push(install),
                Ok(None) => {}
                Err(error) => {
                    tracing::error!(install_id = %install.install_id, error = ?error, "could not park an agent off its machine");
                }
            }
        }
        // They stop them as no longer their own: this machine, and the one
        // an agent moving here still runs on (parking ended the move, so its
        // install is back there).
        let mut machines = Vec::new();
        if !parked.is_empty() {
            tracing::info!(
                parked = parked.len(),
                "parked the agent teammates of an unpaired machine"
            );
            machines.push(harness);
            for install in &parked {
                if !machines.contains(&install.harness_id) {
                    machines.push(install.harness_id);
                }
            }
        }
        // The nudges are hints (an unpaired machine is often gone), so they
        // run alongside the revokes rather than spending the caller's time
        // before them.
        let nudges: Vec<_> = machines
            .into_iter()
            .map(|machine| self.runtimes.installs_changed(machine))
            .collect();
        futures::join!(futures::future::join_all(nudges), self.revoke_each(&parked));
        Ok(parked.len())
    }

    /// Offboard every install on a machine that may no longer host it, and
    /// retry every revoke that failed before this round, a page at a time,
    /// [`OFFBOARD_CONCURRENCY`] at once; one failure doesn't stop the rest.
    /// How many were offboarded and revoked.
    pub(super) async fn offboard_unentitled(&self) -> Result<(usize, usize), TeamAgentError> {
        let installs = self.installs.unentitled_installs(OFFBOARD_PAGE).await?;
        // Collected first: a closure in the stream's type trips the `Send`
        // check of the service's futures.
        let offboards: Vec<_> = installs
            .iter()
            .map(|install| self.try_offboard(install))
            .collect();
        let offboarded: Vec<bool> = futures::stream::iter(offboards)
            .buffer_unordered(OFFBOARD_CONCURRENCY)
            .collect()
            .await;
        // One that just failed waits for the next round rather than taking
        // a second budget in this one.
        let mut pending = self.installs.revoke_pending(OFFBOARD_PAGE).await?;
        pending.retain(|pending| {
            !installs
                .iter()
                .any(|tried| tried.install_id == pending.install_id)
        });
        let revoked = self.revoke_each(&pending).await;
        Ok((count(&offboarded), revoked))
    }

    /// [`Self::offboard`], logging a failure. Whether it worked.
    async fn try_offboard(&self, install: &TeammateInstallRecord) -> bool {
        self.offboard(install)
            .await
            .inspect_err(|error| {
                tracing::error!(install_id = %install.install_id, error = ?error, "could not take an agent off its machine");
            })
            .is_ok()
    }

    /// [`Self::finish_revoke`], logging a failure (it stays pending for the
    /// sweep). Whether it worked.
    async fn try_revoke(&self, install: &TeammateInstallRecord) -> bool {
        self.finish_revoke(install)
            .await
            .inspect_err(|error| {
                tracing::error!(install_id = %install.install_id, error = ?error, "could not revoke an agent's credentials; the sweep retries");
            })
            .is_ok()
    }

    /// Revoke each install's pending credentials, [`OFFBOARD_CONCURRENCY`]
    /// at once. How many were revoked.
    async fn revoke_each(&self, installs: &[TeammateInstallRecord]) -> usize {
        let revokes: Vec<_> = installs
            .iter()
            .map(|install| self.try_revoke(install))
            .collect();
        let revoked: Vec<bool> = futures::stream::iter(revokes)
            .buffer_unordered(OFFBOARD_CONCURRENCY)
            .collect()
            .await;
        count(&revoked)
    }
}

/// How many of `outcomes` worked.
fn count(outcomes: &[bool]) -> usize {
    outcomes.iter().filter(|worked| **worked).count()
}

/// Void every credential an agent's machine holds: its API keys, and its
/// repository token, by issuing a fresh one nobody receives.
pub(super) async fn revoke_credentials(
    repository: &impl TeamAgentRepository,
    api_keys: &impl AgentApiKeys,
    repos: &impl AgentRepos,
    agent: &MacroUserIdStr<'_>,
) -> Result<(), TeamAgentError> {
    let Some(record) = repository
        .get(agent)
        .await
        .map_err(TeamAgentError::internal)?
    else {
        return Ok(());
    };
    api_keys.revoke_all(&record.user_id).await?;
    repos
        .create(&record.user_id, record.team_id, &record.persona_seed)
        .await?;
    Ok(())
}

/// What went wrong with `install`'s current generation, as the machine said.
/// Nothing during a move or removal: what the old machine said no longer
/// describes where the agent is going.
fn install_problem(install: &TeammateInstallRecord) -> Option<InstallProblem> {
    if install.checkpoint.is_some() {
        return None;
    }
    if install.parked() {
        return Some(InstallProblem::HostRemoved);
    }
    match (install.run_state, install.failure) {
        (InstallRunState::Failed, Some(reason)) => Some(InstallProblem::Failed { reason }),
        (InstallRunState::RolledBack, Some(reason)) => Some(InstallProblem::RolledBack { reason }),
        _ => None,
    }
}
