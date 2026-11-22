//! Macro computers' control plane in this process: the fleet operator and
//! its loops, and macrod presence → lifecycle events.
//!
//! Purchases, billing and the team routes live in authentication_service,
//! which owns Stripe; both share the `hosted_runtime*` tables.

use hosted_runtimes::domain::ids::{ComputerId, PairingId};
use hosted_runtimes::domain::image::GuestImages;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use agent_harness::domain::ports::{
    ConnectionRecorded, HarnessConnection, HarnessPresence, RuntimeAccepts, RuntimeConnectionId,
};
use anyhow::Context;
use harness_id::HarnessId;
use harnesses::domain::models::CreateHostedPairing;
use harnesses::domain::ports::{HarnessError, HarnessService};
use harnesses::domain::service::HarnessServiceImpl;
use hosted_runtimes::domain::enrollment::{Deployment, DeploymentSource, DeploymentUnavailable};
use hosted_runtimes::domain::models::{Computer, ControlPlaneId};
use hosted_runtimes::domain::operator::ComputerOperator;
use hosted_runtimes::domain::operator::MacrodConnected;
use hosted_runtimes::domain::ports::{DefaultAgent, Harnesses, HostedPairing};
use hosted_runtimes::domain::service::SystemClock;
use hosted_runtimes::outbound::configured_fleet::ConfiguredFleet;
use hosted_runtimes::outbound::docker_fleet::{DockerFleet, DockerFleetConfig};
use hosted_runtimes::outbound::firecracker_fleet;
use hosted_runtimes::outbound::host_fleets::{FirecrackerSettings, HostFleets};
use hosted_runtimes::outbound::pg::{PgComputerAgents, PgComputerRepo, PgEffectSignals};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use team_agents::outbound::pg_team_agents_repo::PgTeamAgentsRepo;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::config::{ComputerFleetConfig, Config};

pub(crate) mod agent_enrollment;
pub(crate) mod claude;
pub(crate) mod claude_expiry;
pub(crate) mod default_agent;
pub mod harnessd;
mod in_use;
pub(crate) mod moves;
mod presence;
pub mod screen;
pub mod sign_in_ahead;
pub(crate) mod wake;

#[cfg(test)]
mod test;

use default_agent::{DefaultAgentRequest, DefaultAgents};

use presence::PresenceGuard;

const EFFECT_TICK: Duration = Duration::from_secs(2);
const TIMER_TICK: Duration = Duration::from_secs(5);
const RECONCILE_TICK: Duration = Duration::from_secs(60);
/// Memory reports, relief and wakes: well inside the reports' 30 s freshness.
const OVERCOMMIT_TICK: Duration = Duration::from_secs(10);
/// Each open computer move advances one step per pass; a final copy round
/// takes seconds, so the pass is frequent.
const MOVE_TICK: Duration = Duration::from_secs(5);
/// How often expiry notices are checked.
const CLAUDE_SIGN_IN_TICK: Duration = Duration::from_secs(60);
/// How often every awake computer's harnessd status is read, catching a
/// sign-in or sign-out made on the computer itself.
const CLAUDE_STATUS_TICK: Duration = Duration::from_secs(60);

/// The harness service over the harness table, marking agent teammates'
/// computers from the computer table.
pub type PgHarnessService =
    HarnessServiceImpl<harnesses::outbound::pg_harness_repo::PgHarnessRepo, PgComputerAgents>;

/// [`PgHarnessService`] over `pool`.
pub fn harness_service(pool: &PgPool) -> PgHarnessService {
    HarnessServiceImpl::new(
        harnesses::outbound::pg_harness_repo::PgHarnessRepo::new(pool.clone()),
        PgComputerAgents::new(pool.clone()),
    )
}

/// The notification ingress the operator's setup notices go through.
pub type SetupNotifications =
    notification::domain::service::SqsNotificationIngress<notification::outbound::queue::SqsQueue>;

pub type Operator = ComputerOperator<
    PgComputerRepo,
    HostFleets,
    HostedHarnesses,
    SystemClock,
    team_agents::outbound::setup_notices::IngressSetupNotices<SetupNotifications, PgTeamAgentsRepo>,
>;

/// How long a screen waits for its hibernated computer to wake before it
/// tries anyway: Xvnc is up well before macrod dials.
const SCREEN_WAKE_TIMEOUT: Duration = Duration::from_secs(30);

impl screen::tunnel::ScreenWaker for Operator {
    fn wake(
        &self,
        harness: HarnessId,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<screen::tunnel::Woken, screen::tunnel::TunnelError>>
                + Send
                + '_,
        >,
    > {
        use hosted_runtimes::domain::operator::DispatchWake;
        use screen::tunnel::{TunnelError, Woken};
        Box::pin(async move {
            match self.wake_for_dispatch(harness, SCREEN_WAKE_TIMEOUT).await {
                Ok(DispatchWake::NotAComputer) => Err(TunnelError::ComputerOff),
                Ok(DispatchWake::Awake | DispatchWake::Connected) => Ok(Woken::Up),
                Ok(DispatchWake::Waiting) => Ok(Woken::StillWaking),
                Err(error) => Err(TunnelError::Unreachable(error.to_string())),
            }
        })
    }

    fn power(
        &self,
        computer: ComputerId,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<screen::tunnel::ComputerPower, screen::tunnel::TunnelError>>
                + Send
                + '_,
        >,
    > {
        use screen::tunnel::ComputerPower;
        // Asked when a screen stopped short, and before a hand-back's thaw.
        Box::pin(async move {
            Ok(
                if screen::tunnel::ScreenWaker::awake(self)
                    .await?
                    .contains(&computer)
                {
                    ComputerPower::Running
                } else {
                    ComputerPower::NotRunning
                },
            )
        })
    }

    fn awake(
        &self,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        std::collections::HashSet<ComputerId>,
                        screen::tunnel::TunnelError,
                    >,
                > + Send
                + '_,
        >,
    > {
        use screen::tunnel::TunnelError;
        // The fleet's whole list: once per reaping round, not per computer.
        Box::pin(async move {
            Ok(self
                .awake_computers()
                .await
                .map_err(|error| TunnelError::Unreachable(error.to_string()))?
                .into_iter()
                .map(|(_, computer)| computer)
                .collect())
        })
    }
}

impl screen::tunnel::GuestExec for Operator {
    fn exec<'a>(
        &'a self,
        computer: ComputerId,
        argv: &'a [&'a str],
    ) -> Pin<
        Box<
            dyn Future<Output = Result<screen::tunnel::GuestProgram, screen::tunnel::TunnelError>>
                + Send
                + 'a,
        >,
    > {
        use hosted_runtimes::domain::ports::{Fleet as _, FleetError as _};
        use screen::tunnel::{GuestProgram, TunnelError};
        Box::pin(async move {
            let fleet = self
                .fleet_of(computer)
                .await
                .map_err(|error| TunnelError::Unreachable(error.to_string()))?;
            let process = fleet.exec(computer, argv).await.map_err(|error| {
                if error.is_missing() {
                    TunnelError::ComputerOff
                } else {
                    TunnelError::Unreachable(error.to_string())
                }
            })?;
            let exit = process.exit;
            Ok(GuestProgram {
                stdin: process.stdin,
                stdout: process.stdout,
                exit: Box::pin(async move { exit.await.map_err(|error| error.to_string()) }),
            })
        })
    }
}

/// Build the operator from explicit config, or `None` when this deployment
/// has no attached computer fleet (`COMPUTERS_FLEET` is absent).
pub(crate) async fn operator(
    config: &Config,
    fleet_config: Option<ComputerFleetConfig>,
    pool: &PgPool,
    harnesses: Arc<dyn HostedHarnessService>,
    default_agents: Arc<dyn DefaultAgents>,
    notifications: Arc<SetupNotifications>,
    runtime_bus: redis::Client,
) -> anyhow::Result<Option<Arc<Operator>>> {
    let Some(fleet_config) = fleet_config else {
        tracing::warn!("no computer fleet attached; computer routes are unavailable");
        return Ok(None);
    };
    let fleet = match fleet_config {
        ComputerFleetConfig::Firecracker(settings) => HostFleets::new(
            None,
            Some(FirecrackerSettings {
                control_plane_id: ControlPlaneId::try_new(&settings.computers_control_plane_id)?,
                client_cert_pem: settings.computers_firecracker_client_cert.clone(),
                client_key_pem: zeroize::Zeroizing::new(
                    settings.computers_firecracker_client_key.clone(),
                ),
                connect_timeout: firecracker_fleet::CONNECT_TIMEOUT,
                request_timeout: firecracker_fleet::REQUEST_TIMEOUT,
                images: GuestImages {
                    regular: settings.computers_image.as_str(),
                    agent: settings.computers_agent_image.as_str(),
                }
                .try_map(hosted_runtimes::domain::image::GuestImage::try_new)?,
            }),
        ),
        ComputerFleetConfig::Docker(settings) => HostFleets::new(
            Some(ConfiguredFleet::Docker(
                DockerFleet::new(
                    DockerFleetConfig {
                        control_plane_id: ControlPlaneId::try_new(
                            &settings.computers_control_plane_id,
                        )?,
                        images: GuestImages {
                            regular: settings.computers_image.as_str(),
                            agent: settings.computers_agent_image.as_str(),
                        }
                        .try_map(hosted_runtimes::domain::image::GuestImage::try_new)?,
                        network: settings.computers_docker_network.clone(),
                        enrollment_dir: settings.computers_docker_enrollment_dir.clone().into(),
                        host_name: hosted_runtimes::domain::models::HostName::try_new(
                            &settings.computers_host_name,
                        )?,
                        memory_gb: settings.computers_docker_memory_gb,
                    },
                    config.environment,
                )
                .context("could not build the Docker fleet")?,
            )),
            // A local stack drives no Firecracker hosts.
            None,
        ),
    };

    // Fail startup on unresolvable addresses rather than at the first purchase.
    ServiceDeployment.deployment()?;

    let operator = ComputerOperator::start(
        PgComputerRepo::new(operator_pool(pool), config.computer_billing_policy()?),
        fleet,
        HostedHarnesses {
            service: harnesses,
            default_agents,
            runtime_bus,
        },
        team_agents::outbound::setup_notices::IngressSetupNotices::new(
            notifications,
            PgTeamAgentsRepo::new(pool.clone()),
        ),
        SystemClock,
        Arc::new(ServiceDeployment),
    )
    .await
    .map_err(|error| anyhow::anyhow!("computer operator failed to start: {error}"))?
    .with_computers_in_use(Arc::new(in_use::SessionsInUse::new(
        PgComputerRepo::new(operator_pool(pool), config.computer_billing_policy()?),
        pool.clone(),
    )));
    Ok(Some(Arc::new(operator)))
}

/// One connection per concurrent pass. The control plane gets its own pool
/// so a burst of session traffic (or macrod reconnecting after a deploy)
/// cannot starve it, and its waits stay short: a pass that cannot get a
/// connection skips its tick instead of queueing behind the burst.
const OPERATOR_CONNECTIONS: u32 = 5;
/// How long a pass waits for a connection before skipping its tick.
const OPERATOR_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);
/// Return idle connections; the database is shared by every service.
const OPERATOR_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// The operator's own pool, on connections made like `pool`'s.
fn operator_pool(pool: &PgPool) -> PgPool {
    PgPoolOptions::new()
        .max_connections(OPERATOR_CONNECTIONS)
        .acquire_timeout(OPERATOR_ACQUIRE_TIMEOUT)
        .idle_timeout(OPERATOR_IDLE_TIMEOUT)
        .connect_lazy_with(pool.connect_options().as_ref().clone())
}

/// The deployment a computer joins: this service's own typed addresses,
/// which local stacks override per fleet (`OVERRIDE_*`), resolved for each
/// enrollment.
pub struct ServiceDeployment;

impl DeploymentSource for ServiceDeployment {
    fn deployment(&self) -> Result<Deployment, DeploymentUnavailable> {
        resolve_deployment().map_err(|error| {
            tracing::error!(error = ?error, "could not resolve the computer deployment");
            DeploymentUnavailable
        })
    }
}

fn resolve_deployment() -> anyhow::Result<Deployment> {
    use macro_service_urls::{
        AgentHarnessEgressUrl, AgentHarnessServiceUrl, AppServiceUrl, DocumentStorageServiceUrl,
        TelemetryIntakeUrl,
    };
    Ok(Deployment {
        agent_harness_url: AgentHarnessServiceUrl::new()?.parse_url()?,
        document_storage_url: DocumentStorageServiceUrl::new()?.parse_url()?,
        app_url: AppServiceUrl::new()?.parse_url()?,
        egress_url: AgentHarnessEgressUrl::new()?.parse_url()?,
        telemetry_url: computer_reachable(TelemetryIntakeUrl::new()?.parse_url()?),
    })
}

/// `url`, unless it is this machine's loopback (`localhost`, a name under it,
/// which RFC 6761 keeps on loopback, or a loopback or unspecified address,
/// as the authentication service's `agent_addresses` judges), which a computer
/// can't reach (a local stack whose collector isn't wired for computers): the
/// computer then exports no spans.
fn computer_reachable(url: macro_service_urls::Url) -> Option<macro_service_urls::Url> {
    let loopback = url.host_str().is_some_and(|host| {
        let host = host.to_ascii_lowercase();
        host == "localhost"
            || host.ends_with(".localhost")
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
    });
    (!loopback).then_some(url)
}

/// The operator's periodic passes.
#[derive(Debug, Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Pass {
    Effects,
    Timers,
    Reconcile,
    Overcommit,
    Moves,
    ClaudeSignIns,
    ClaudeStatus,
}

impl Pass {
    fn tick(self) -> Duration {
        match self {
            Self::Effects => EFFECT_TICK,
            Self::Timers => TIMER_TICK,
            Self::Reconcile => RECONCILE_TICK,
            Self::Overcommit => OVERCOMMIT_TICK,
            Self::Moves => MOVE_TICK,
            Self::ClaudeSignIns => CLAUDE_SIGN_IN_TICK,
            Self::ClaudeStatus => CLAUDE_STATUS_TICK,
        }
    }
}

/// The Claude sign-in watch's ports.
pub struct ClaudeSignInWatch<Ingress> {
    /// Computers signed in to Claude through Macro.
    pub sign_ins: hosted_runtimes::outbound::pg_sign_ins::PgClaudeSignIns,
    /// Their notices.
    pub notices: claude_expiry::IngressClaudeSignInNotices<Ingress>,
    /// harnessd on every computer, whose status the watch refreshes.
    pub harnessd: HostedHarnessd,
}

/// [`harnessd::Harnessd`] over the harness table.
pub type HostedHarnessd = harnessd::Harnessd<PgHarnessService>;

/// Run the operator's passes until `shutdown`. The effect pass also runs as
/// soon as `effect_signals` hears of a queued fleet effect, so a purchase
/// does not wait out [`EFFECT_TICK`].
pub fn spawn_loops<Ingress: notification::domain::service::NotificationIngress>(
    operator: Arc<Operator>,
    claude_sign_ins: ClaudeSignInWatch<Ingress>,
    effect_signals: PgEffectSignals,
    tracker: &TaskTracker,
    shutdown: CancellationToken,
) {
    let claude_sign_ins = Arc::new(claude_sign_ins);
    for pass in [
        Pass::Effects,
        Pass::Timers,
        Pass::Reconcile,
        Pass::Overcommit,
        Pass::Moves,
        Pass::ClaudeSignIns,
        Pass::ClaudeStatus,
    ] {
        tracker.spawn(run_pass(
            pass,
            Arc::clone(&operator),
            Arc::clone(&claude_sign_ins),
            effect_signals.clone(),
            shutdown.clone(),
        ));
    }
}

async fn run_pass<Ingress: notification::domain::service::NotificationIngress>(
    pass: Pass,
    operator: Arc<Operator>,
    claude_sign_ins: Arc<ClaudeSignInWatch<Ingress>>,
    effect_signals: PgEffectSignals,
    shutdown: CancellationToken,
) {
    let mut interval = tokio::time::interval(pass.tick());
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Consecutive passes skipped because the database had no connection to give.
    let mut skipped: u32 = 0;
    loop {
        // The tick stays as the backstop for retries that come due and for
        // notifications lost while the listener reconnected.
        let queued = async {
            match pass {
                Pass::Effects => effect_signals.fleet_effect_queued().await,
                Pass::Timers
                | Pass::Reconcile
                | Pass::Overcommit
                | Pass::Moves
                | Pass::ClaudeSignIns
                | Pass::ClaudeStatus => std::future::pending().await,
            }
        };
        tokio::select! {
            biased;
            () = shutdown.cancelled() => return,
            _ = interval.tick() => {}
            () = queued => {}
        }
        let outcome: anyhow::Result<()> =
            match pass {
                Pass::Effects => operator
                    .run_fleet_effects_until(shutdown.cancelled())
                    .await
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
                Pass::Timers => shutdown
                    .run_until_cancelled(operator.fire_timers())
                    .await
                    .transpose()
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
                Pass::Reconcile => shutdown
                    .run_until_cancelled(operator.reconcile())
                    .await
                    .transpose()
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
                Pass::Overcommit => shutdown
                    .run_until_cancelled(operator.overcommit())
                    .await
                    .transpose()
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
                Pass::Moves => shutdown
                    .run_until_cancelled(operator.advance_moves())
                    .await
                    .transpose()
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
                Pass::ClaudeSignIns => shutdown
                    .run_until_cancelled(operator.notify_claude_sign_ins(
                        &claude_sign_ins.sign_ins,
                        &claude_sign_ins.notices,
                    ))
                    .await
                    .transpose()
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
                Pass::ClaudeStatus => shutdown
                    .run_until_cancelled(async {
                        let computers = operator.awake_computers().await?;
                        claude_sign_ins.harnessd.refresh_each(&computers).await;
                        Ok::<_, hosted_runtimes::domain::service::ComputerError>(())
                    })
                    .await
                    .transpose()
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
            };
        let name: &'static str = pass.into();
        match outcome {
            Ok(()) => {
                if skipped > 0 {
                    tracing::info!(pass = name, skipped, "computer pass resumed");
                }
                skipped = 0;
            }
            // A busy pool is not a failure: skip this tick and try the next,
            // warning once per outage rather than on every tick.
            Err(error) if storage_unavailable(&error) => {
                if skipped == 0 {
                    tracing::warn!(
                        pass = name,
                        "computer storage unavailable; skipping passes until it recovers"
                    );
                }
                skipped = skipped.saturating_add(1);
            }
            Err(error) => {
                tracing::error!(pass = name, error = ?error, "computer pass failed");
            }
        }
    }
}

fn storage_unavailable(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<hosted_runtimes::domain::service::ComputerError>()
        .is_some_and(hosted_runtimes::domain::service::ComputerError::is_storage_unavailable)
}

/// The slice of [`HarnessService`] the control plane uses; object-safe so
/// the composition root can hand over its existing service.
pub trait HostedHarnessService: Send + Sync + 'static {
    fn create_hosted_pairing(
        &self,
        request: CreateHostedPairing,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<harnesses::domain::models::HostedPairing, HarnessError>>
                + Send
                + '_,
        >,
    >;

    fn hosted_pairing_claimed(
        &self,
        pairing_id: PairingId,
    ) -> Pin<Box<dyn Future<Output = Result<bool, HarnessError>> + Send + '_>>;

    fn revoke_hosted_harness(
        &self,
        computer_id: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<(), HarnessError>> + Send + '_>>;

    fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<ComputerId>, HarnessError>> + Send + '_>>;

    fn computer_harnesses(
        &self,
        computer_id: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<HarnessId>, HarnessError>> + Send + '_>>;
}

impl<Service: HarnessService + Send + Sync + 'static> HostedHarnessService for Service {
    fn create_hosted_pairing(
        &self,
        request: CreateHostedPairing,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<harnesses::domain::models::HostedPairing, HarnessError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(HarnessService::create_hosted_pairing(self, request))
    }

    fn hosted_pairing_claimed(
        &self,
        pairing_id: PairingId,
    ) -> Pin<Box<dyn Future<Output = Result<bool, HarnessError>> + Send + '_>> {
        Box::pin(HarnessService::hosted_pairing_claimed(self, pairing_id))
    }

    fn revoke_hosted_harness(
        &self,
        computer_id: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<(), HarnessError>> + Send + '_>> {
        Box::pin(HarnessService::revoke_hosted_harness(self, computer_id))
    }

    fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<ComputerId>, HarnessError>> + Send + '_>> {
        Box::pin(HarnessService::harness_computer(self, harness_id))
    }

    fn computer_harnesses(
        &self,
        computer_id: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<HarnessId>, HarnessError>> + Send + '_>> {
        Box::pin(HarnessService::computer_harnesses(self, computer_id))
    }
}

/// [`Harnesses`] over the harnesses crate: the buyer owns an approved harness
/// shared with the team, so macrod claims it without a pairing code. The
/// team's default agent on it comes from the bots crate.
pub struct HostedHarnesses {
    service: Arc<dyn HostedHarnessService>,
    default_agents: Arc<dyn DefaultAgents>,
    /// Where agent hand-offs go to the replica holding macrod's socket.
    runtime_bus: redis::Client,
}

#[derive(Debug, thiserror::Error)]
pub enum HostedHarnessError {
    #[error(transparent)]
    Harness(#[from] HarnessError),
    #[error(transparent)]
    DefaultAgent(#[from] default_agent::DefaultAgentError),
    #[error(transparent)]
    Bus(#[from] crate::runtime_commands::RuntimeBusError),
}

impl Harnesses for HostedHarnesses {
    type Err = HostedHarnessError;

    async fn create_hosted_pairing(&self, computer: &Computer) -> Result<HostedPairing, Self::Err> {
        let pairing = self
            .service
            .create_hosted_pairing(CreateHostedPairing {
                team_id: computer.team_id,
                name: computer.name.as_str().to_owned(),
                created_by: computer.created_by.clone(),
                computer_id: computer.id,
            })
            .await?;
        Ok(HostedPairing {
            pairing_id: pairing.pairing_id,
            device_secret: hosted_runtimes::domain::enrollment::DeviceSecret::new(
                pairing.device_secret.expose().to_owned(),
            ),
        })
    }

    async fn pairing_claimed(&self, pairing_id: PairingId) -> Result<bool, Self::Err> {
        Ok(self.service.hosted_pairing_claimed(pairing_id).await?)
    }

    async fn computer_for(&self, harness_id: HarnessId) -> Result<Option<ComputerId>, Self::Err> {
        Ok(self.service.harness_computer(harness_id).await?)
    }

    async fn revoke(&self, computer: &Computer) -> Result<(), Self::Err> {
        // The harness goes first. Its delete locks the row that every agent
        // bind holds while it writes, so once it commits no new agent can
        // bind, and a computer's agents stay bound to a deleted harness: the
        // deletion below finds every one, on a retried effect too.
        self.service.revoke_hosted_harness(computer.id).await?;
        for harness_id in self.service.computer_harnesses(computer.id).await? {
            let deleted = self
                .default_agents
                .delete_bound(computer.created_by.clone(), harness_id)
                .await?;
            tracing::info!(computer_id = %computer.id, %harness_id, deleted, "deleted the computer's agents");
        }
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn deliver_agent(
        &self,
        harness_id: HarnessId,
        computer_id: ComputerId,
        generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration,
    ) -> Result<(), Self::Err> {
        crate::runtime_commands::publish_deliver_agent(
            &self.runtime_bus,
            &crate::runtime_commands::DeliverAgent::new(harness_id, computer_id, generation),
        )
        .await?;
        Ok(())
    }

    async fn create_default_agent(
        &self,
        computer: &Computer,
        harness_id: HarnessId,
    ) -> Result<DefaultAgent, Self::Err> {
        Ok(self
            .default_agents
            .create(DefaultAgentRequest {
                team_id: computer.team_id,
                buyer: computer.created_by.clone(),
                harness_id,
            })
            .await?)
    }
}

/// [`HarnessPresence`] that also tells the operator.
pub struct ComputerPresence<Inner> {
    inner: Arc<Inner>,
    presence_pool: PgPool,
    operator: Option<Arc<Operator>>,
    /// Set once the command bus exists, which needs the runtime registry
    /// this presence is part of.
    sign_in_ahead: Arc<std::sync::OnceLock<SignInAheadHandle>>,
    tasks: TaskTracker,
}

/// [`sign_in_ahead::SignInAhead`] over the harness table.
pub type SignInAheadHandle = Arc<sign_in_ahead::SignInAhead<PgHarnessService>>;

impl<Inner> ComputerPresence<Inner> {
    pub fn new(
        inner: Arc<Inner>,
        operator: Option<Arc<Operator>>,
        pool: PgPool,
        sign_in_ahead: Arc<std::sync::OnceLock<SignInAheadHandle>>,
        tasks: TaskTracker,
    ) -> Self {
        let presence_pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy_with(pool.connect_options().as_ref().clone());
        Self {
            inner,
            presence_pool,
            operator,
            sign_in_ahead,
            tasks,
        }
    }
}

impl<Inner: HarnessPresence> HarnessPresence for ComputerPresence<Inner> {
    fn connected(
        self: Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        accepts: RuntimeAccepts,
    ) -> Pin<Box<dyn Future<Output = ConnectionRecorded> + Send>> {
        Box::pin(async move {
            let mut guard = match PresenceGuard::lock(&self.presence_pool, harness).await {
                Ok(guard) => guard,
                Err(error) => {
                    tracing::error!(%harness, error = ?error, "failed to serialize computer connect");
                    return ConnectionRecorded::AgentsUnchanged;
                }
            };
            let mut recorded = Arc::clone(&self.inner)
                .connected(harness, connection, accepts)
                .await;
            match guard.is_connected().await {
                Ok(true) => {}
                Ok(false) => return recorded,
                Err(error) => {
                    tracing::error!(%harness, error = ?error, "failed to observe computer connection");
                    return recorded;
                }
            }
            if let Some(operator) = &self.operator
                && let Ok(MacrodConnected::AgentBound) = operator
                    .macrod_connected(harness, accepts.apply_agent)
                    .await
                    .inspect_err(|error| tracing::error!(%harness, error = ?error, "computer connect event failed"))
            {
                recorded = ConnectionRecorded::AgentBound;
            }
            drop(guard);
            // After the presence lock: the command execs harnessd on the computer.
            if let Some(ahead) = self.sign_in_ahead.get() {
                let ahead = Arc::clone(ahead);
                self.tasks
                    .spawn(async move { ahead.on_connected(harness).await });
            }
            recorded
        })
    }

    fn disconnected(
        self: Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            let mut guard = match PresenceGuard::lock(&self.presence_pool, harness).await {
                Ok(guard) => guard,
                Err(error) => {
                    tracing::error!(%harness, error = ?error, "failed to serialize computer disconnect");
                    return;
                }
            };
            Arc::clone(&self.inner)
                .disconnected(harness, connection)
                .await;
            match guard.is_connected().await {
                Ok(true) => return,
                Ok(false) => {}
                Err(error) => {
                    tracing::error!(%harness, error = ?error, "failed to observe computer disconnection");
                    return;
                }
            }
            if let Some(operator) = &self.operator {
                operator
                    .macrod_disconnected(harness)
                    .await
                    .inspect_err(|error| tracing::error!(%harness, error = ?error, "computer disconnect event failed"))
                    .ok();
            }
        })
    }
    fn renew(
        self: Arc<Self>,
        live: Vec<HarnessConnection>,
    ) -> Pin<Box<dyn Future<Output = Vec<HarnessConnection>> + Send>> {
        Arc::clone(&self.inner).renew(live)
    }
}

/// [`harnessd::HarnessdTransport`] over the operator's fleet: one `harnessd` process
/// per request, its request on stdin and its answer on stdout.
pub struct FleetTransport {
    operator: Arc<Operator>,
}

impl FleetTransport {
    /// Exec through `operator`'s fleet.
    pub fn new(operator: Arc<Operator>) -> Self {
        Self { operator }
    }
}

impl harnessd::HarnessdTransport for FleetTransport {
    fn round_trip(
        &self,
        computer_id: ComputerId,
        request: harnessd_protocol::Request,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<harnessd_protocol::Response, harnessd::HarnessdError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            use hosted_runtimes::domain::ports::Fleet as _;

            let deadline = harnessd::answer_timeout(&request);
            let exchange = async {
                let fleet = self
                    .operator
                    .fleet_of(computer_id)
                    .await
                    .map_err(|error| harnessd::HarnessdError::Unreachable(error.to_string()))?;
                let process = fleet
                    .exec(computer_id, &[harnessd::HARNESSD])
                    .await
                    .map_err(|error| harnessd::HarnessdError::Unreachable(error.to_string()))?;
                harnessd::exchange(process, &request).await
            };
            tokio::time::timeout(deadline, exchange)
                .await
                .map_err(|_| harnessd::HarnessdError::Timeout)?
        })
    }
}
