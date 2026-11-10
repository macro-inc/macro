//! Macro computers' control plane in this process: the fleet operator and
//! its loops, and macrod presence → lifecycle events.
//!
//! Purchases, billing and the team routes live in authentication_service,
//! which owns Stripe; both share the `hosted_runtime*` tables.

use hosted_runtimes::domain::ids::{ComputerId, PairingId};

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use agent_harness::domain::ports::{HarnessPresence, RuntimeConnectionId};
use anyhow::Context;
use harness_id::HarnessId;
use harnesses::domain::models::CreateHostedPairing;
use harnesses::domain::ports::{HarnessError, HarnessService};
use hosted_runtimes::domain::enrollment::{Deployment, DeploymentSource, DeploymentUnavailable};
use hosted_runtimes::domain::models::{Computer, ControlPlaneId};
use hosted_runtimes::domain::operator::ComputerOperator;
use hosted_runtimes::domain::ports::{DefaultAgent, Harnesses, HostedPairing};
use hosted_runtimes::domain::service::SystemClock;
use hosted_runtimes::outbound::configured_fleet::ConfiguredFleet;
use hosted_runtimes::outbound::docker_fleet::{DockerFleet, DockerFleetConfig};
use hosted_runtimes::outbound::incus_fleet::{IncusFleet, IncusFleetConfig};
use hosted_runtimes::outbound::pg::PgComputerRepo;
use incus_client::{ImageReference, ImageSource, IncusEndpoint, IncusTimeouts};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::config::{ComputerFleetConfig, Config};

pub(crate) mod claude;
pub(crate) mod claude_expiry;
pub(crate) mod control;
pub(crate) mod default_agent;
mod presence;

use default_agent::{DefaultAgentRequest, DefaultAgents};

use presence::PresenceGuard;

const EFFECT_TICK: Duration = Duration::from_secs(2);
const TIMER_TICK: Duration = Duration::from_secs(5);
const RECONCILE_TICK: Duration = Duration::from_secs(60);
/// macrod reports a rejected sign-in within about a minute; checking as often
/// keeps that notice prompt.
const CLAUDE_SIGN_IN_TICK: Duration = Duration::from_secs(60);

pub type Operator = ComputerOperator<PgComputerRepo, ConfiguredFleet, HostedHarnesses, SystemClock>;

/// Build the operator from explicit config, or `None` when this deployment
/// has no attached computer fleet (`COMPUTERS_FLEET` is absent).
pub(crate) async fn operator(
    config: &Config,
    fleet_config: Option<ComputerFleetConfig>,
    pool: &PgPool,
    harnesses: Arc<dyn HostedHarnessService>,
    default_agents: Arc<dyn DefaultAgents>,
) -> anyhow::Result<Option<Arc<Operator>>> {
    let Some(fleet_config) = fleet_config else {
        tracing::warn!("no computer fleet attached; computer routes are unavailable");
        return Ok(None);
    };
    let fleet = match fleet_config {
        ComputerFleetConfig::Incus(settings) => ConfiguredFleet::Incus(
            IncusFleet::new(IncusFleetConfig {
                endpoint: IncusEndpoint {
                    url: settings.computers_incus_url.clone(),
                    timeouts: IncusTimeouts {
                        state_change_secs: settings.computers_incus_state_change_timeout_secs,
                        request: Duration::from_secs(settings.computers_incus_request_timeout_secs),
                        connect: Duration::from_secs(settings.computers_incus_connect_timeout_secs),
                        operation_wait_secs: settings.computers_incus_operation_wait_secs,
                        operation_waits: settings.computers_incus_operation_waits,
                    },
                    client_cert_pem: settings.computers_incus_client_cert.clone(),
                    client_key_pem: settings.computers_incus_client_key.clone(),
                    server_cert_pem: settings.computers_incus_server_cert.clone(),
                },
                host_name: settings.computers_host_name.clone(),
                control_plane_id: ControlPlaneId::parse(
                    settings.computers_control_plane_id.clone(),
                )?,
                reserve_gb: settings.computers_host_reserve_gb,
                oversell_factor: settings.computers_oversell_factor,
                image: ImageSource {
                    reference: ImageReference::Alias(incus_client::ImageAlias::try_new(
                        &settings.computers_image,
                    )?),
                    remote: None,
                },
                profile: incus_client::ProfileName::try_new(
                    &settings.computers_incus_profile.clone(),
                )?,
                storage_pool: incus_client::StoragePoolName::try_new(
                    &settings.computers_incus_storage_pool.clone(),
                )?,
                shutdown_grace: Duration::from_secs(settings.computers_incus_shutdown_grace_secs),
            })
            .context("could not build the Incus fleet")?,
        ),
        ComputerFleetConfig::Docker(settings) => ConfiguredFleet::Docker(
            DockerFleet::new(
                DockerFleetConfig {
                    control_plane_id: ControlPlaneId::parse(
                        settings.computers_control_plane_id.clone(),
                    )?,
                    image: settings.computers_image.clone(),
                    network: settings.computers_docker_network.clone(),
                    enrollment_dir: settings.computers_docker_enrollment_dir.clone().into(),
                    host_name: settings.computers_host_name.clone(),
                    memory_gb: settings.computers_docker_memory_gb,
                    reserve_gb: settings.computers_host_reserve_gb,
                    oversell_factor: settings.computers_oversell_factor,
                },
                config.environment,
            )
            .context("could not build the Docker fleet")?,
        ),
    };

    // Fail startup on unresolvable addresses rather than at the first purchase.
    ServiceDeployment.deployment()?;

    let operator = ComputerOperator::start(
        PgComputerRepo::new(pool.clone()),
        fleet,
        HostedHarnesses {
            service: harnesses,
            default_agents,
        },
        SystemClock,
        Arc::new(ServiceDeployment),
    )
    .await
    .map_err(|error| anyhow::anyhow!("computer operator failed to start: {error}"))?;
    Ok(Some(Arc::new(operator)))
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
    };
    Ok(Deployment {
        agent_harness_url: AgentHarnessServiceUrl::new()?.parse_url()?,
        document_storage_url: DocumentStorageServiceUrl::new()?.parse_url()?,
        app_url: AppServiceUrl::new()?.parse_url()?,
        egress_url: AgentHarnessEgressUrl::new()?.parse_url()?,
    })
}

/// The operator's periodic passes.
#[derive(Debug, Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Pass {
    Effects,
    Timers,
    Reconcile,
    ClaudeSignIns,
}

impl Pass {
    fn tick(self) -> Duration {
        match self {
            Self::Effects => EFFECT_TICK,
            Self::Timers => TIMER_TICK,
            Self::Reconcile => RECONCILE_TICK,
            Self::ClaudeSignIns => CLAUDE_SIGN_IN_TICK,
        }
    }
}

/// The Claude sign-in watch's ports.
pub struct ClaudeSignInWatch<Ingress> {
    /// Computers signed in to Claude through Macro.
    pub sign_ins: claude_expiry::PgClaudeSignIns,
    /// Their notices.
    pub notices: claude_expiry::IngressClaudeSignInNotices<Ingress>,
}

/// Run the operator's passes until `shutdown`.
pub fn spawn_loops<Ingress: notification::domain::service::NotificationIngress>(
    operator: Arc<Operator>,
    claude_sign_ins: ClaudeSignInWatch<Ingress>,
    tracker: &TaskTracker,
    shutdown: CancellationToken,
) {
    let claude_sign_ins = Arc::new(claude_sign_ins);
    for pass in [
        Pass::Effects,
        Pass::Timers,
        Pass::Reconcile,
        Pass::ClaudeSignIns,
    ] {
        tracker.spawn(run_pass(
            pass,
            Arc::clone(&operator),
            Arc::clone(&claude_sign_ins),
            shutdown.clone(),
        ));
    }
}

async fn run_pass<Ingress: notification::domain::service::NotificationIngress>(
    pass: Pass,
    operator: Arc<Operator>,
    claude_sign_ins: Arc<ClaudeSignInWatch<Ingress>>,
    shutdown: CancellationToken,
) {
    let mut interval = tokio::time::interval(pass.tick());
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            () = shutdown.cancelled() => return,
            _ = interval.tick() => {}
        }
        let outcome =
            match pass {
                Pass::Effects => operator
                    .run_fleet_effects_until(shutdown.cancelled())
                    .await
                    .map(|_| ()),
                Pass::Timers => shutdown
                    .run_until_cancelled(operator.fire_timers())
                    .await
                    .transpose()
                    .map(|_| ()),
                Pass::Reconcile => shutdown
                    .run_until_cancelled(operator.reconcile())
                    .await
                    .transpose()
                    .map(|_| ()),
                Pass::ClaudeSignIns => shutdown
                    .run_until_cancelled(operator.notify_claude_sign_ins(
                        &claude_sign_ins.sign_ins,
                        &claude_sign_ins.notices,
                    ))
                    .await
                    .transpose()
                    .map(|_| ()),
            };
        if let Err(error) = outcome {
            let name: &'static str = pass.into();
            tracing::error!(pass = name, error = ?error, "computer pass failed");
        }
    }
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
}

#[derive(Debug, thiserror::Error)]
pub enum HostedHarnessError {
    #[error(transparent)]
    Harness(#[from] HarnessError),
    #[error(transparent)]
    DefaultAgent(#[from] default_agent::DefaultAgentError),
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
}

impl<Inner> ComputerPresence<Inner> {
    pub fn new(inner: Arc<Inner>, operator: Option<Arc<Operator>>, pool: PgPool) -> Self {
        let presence_pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy_with(pool.connect_options().as_ref().clone());
        Self {
            inner,
            presence_pool,
            operator,
        }
    }
}

impl<Inner: HarnessPresence> HarnessPresence for ComputerPresence<Inner> {
    fn connected(
        self: Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            let mut guard = match PresenceGuard::lock(&self.presence_pool, harness).await {
                Ok(guard) => guard,
                Err(error) => {
                    tracing::error!(%harness, error = ?error, "failed to serialize computer connect");
                    return;
                }
            };
            Arc::clone(&self.inner).connected(harness, connection).await;
            match guard.is_connected().await {
                Ok(true) => {}
                Ok(false) => return,
                Err(error) => {
                    tracing::error!(%harness, error = ?error, "failed to observe computer connection");
                    return;
                }
            }
            if let Some(operator) = &self.operator {
                operator
                    .macrod_connected(harness)
                    .await
                    .inspect_err(|error| tracing::error!(%harness, error = ?error, "computer connect event failed"))
                    .ok();
            }
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
        live: Vec<(HarnessId, RuntimeConnectionId)>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Arc::clone(&self.inner).renew(live)
    }
}
