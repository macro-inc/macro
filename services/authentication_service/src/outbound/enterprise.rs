//! Composition-root adapters for enterprise ports.

use enterprise::domain::{
    EnterpriseError, EnterpriseService, HarnessRevoker, MemberDirectory, Result, TeamDirectory,
    UserLifecycle,
};
use fusionauth::{
    FusionAuthClient,
    error::{FusionAuthClientError, GenericErrorResponse},
};
use harnesses::{
    domain::{models::HarnessOwner, ports::HarnessRepo},
    outbound::pg_harness_repo::PgHarnessRepo,
};
use macro_auth::middleware::decode_jwt::{
    JwtValidationArgs, decode_macro_access_token_allow_expired,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use std::sync::Arc;
use teams::{domain::team_repo::TeamRepository, outbound::team_repo::TeamRepositoryImpl};
use uuid::Uuid;

/// Team membership adapter that exposes no billing enterprise-flag read.
#[derive(Clone)]
pub struct EnterpriseTeams(TeamRepositoryImpl);

impl TeamDirectory for EnterpriseTeams {
    async fn team_ids(&self, user: MacroUserIdStr<'static>) -> Result<Vec<Uuid>> {
        self.0
            .get_user_teams(&user)
            .await
            .map(|teams| teams.into_iter().map(|team| *team.id()).collect())
            .map_err(|error| EnterpriseError::Storage(error.into()))
    }
}

/// Soft-only FusionAuth lifecycle adapter.
#[derive(Clone)]
pub struct FusionAuthLifecycle(Arc<FusionAuthClient>);

impl UserLifecycle for FusionAuthLifecycle {
    async fn deactivate_user(&self, fusion_user_id: &str) -> Result<()> {
        self.0
            .deactivate_user(fusion_user_id)
            .await
            .map_err(|error| EnterpriseError::Storage(error.into()))
    }

    async fn reactivate_user(&self, fusion_user_id: &str) -> Result<()> {
        self.0
            .reactivate_user(fusion_user_id)
            .await
            .map_err(|error| EnterpriseError::Storage(error.into()))
    }
}

/// User identity lookup composed at the service boundary.
#[derive(Clone)]
pub struct PgMemberDirectory(PgPool);

impl MemberDirectory for PgMemberDirectory {
    async fn fusion_user_id(&self, user: &MacroUserIdStr<'_>) -> Result<String> {
        let fusion_user_id = sqlx::query_scalar!(
            r#"SELECT u.id FROM "User" u JOIN macro_user m ON m.id = u.macro_user_id WHERE lower(m.email) = lower($1)"#,
            user.email_str(),
        )
        .fetch_optional(&self.0)
        .await
        .map_err(|error| EnterpriseError::Storage(error.into()))?;
        fusion_user_id.ok_or(EnterpriseError::UnknownUser)
    }
}

/// Server-side harness revocation. No local file path or credential is read or logged.
#[derive(Clone)]
pub struct ServerHarnessRevocation(PgHarnessRepo);

impl HarnessRevoker for ServerHarnessRevocation {
    async fn revoke_server_records(&self, member: &MacroUserIdStr<'_>) -> Result<usize> {
        let harnesses = self
            .0
            .list_directory_harnesses(member.clone().into_owned())
            .await
            .map_err(EnterpriseError::Storage)?;
        let owned: Vec<_> = harnesses
            .into_iter()
            .filter(|harness| {
                matches!(
                    &harness.owner,
                    HarnessOwner::User { user_id } if user_id == member.as_ref()
                )
            })
            .collect();

        let mut revoked = 0;
        for harness in owned {
            if self
                .0
                .delete_harness(harness.id)
                .await
                .map_err(EnterpriseError::Storage)?
            {
                revoked += 1;
            }
        }
        Ok(revoked)
    }
}

/// Credential-free audit observer invoked inside FusionAuth login persistence functions.
pub struct EnterpriseLoginAudit {
    enterprise: Arc<EnterpriseServiceType>,
    jwt_args: JwtValidationArgs,
}

impl EnterpriseLoginAudit {
    /// Compose the recorder without retaining tokens or login payloads.
    pub fn new(enterprise: Arc<EnterpriseServiceType>, jwt_args: JwtValidationArgs) -> Self {
        Self {
            enterprise,
            jwt_args,
        }
    }
}

impl std::fmt::Debug for EnterpriseLoginAudit {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("EnterpriseLoginAudit")
            .finish_non_exhaustive()
    }
}

impl fusionauth::LoginAudit for EnterpriseLoginAudit {
    fn record<'a>(
        &'a self,
        access_token: &'a str,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = std::result::Result<(), FusionAuthClientError>> + Send + 'a>,
    > {
        Box::pin(async move {
            let failure = || {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: "login audit unavailable".into(),
                })
            };
            let decoded = decode_macro_access_token_allow_expired(access_token, &self.jwt_args)
                .map_err(|_| failure())?;
            let actor = MacroUserIdStr::parse_from_str(decoded.as_ref()).map_err(|_| failure())?;
            self.enterprise
                .record_login(&actor)
                .await
                .map_err(|_| failure())
        })
    }
}

/// Concrete admin service mounted by authentication-service.
pub type EnterpriseServiceType = EnterpriseService<
    enterprise::outbound::PgEnterpriseRepository,
    EnterpriseTeams,
    FusionAuthLifecycle,
    PgMemberDirectory,
    ServerHarnessRevocation,
>;

/// Compose the production enterprise service. The identity broker remains a separate typed gap.
pub fn enterprise_service(
    pool: PgPool,
    auth_client: Arc<FusionAuthClient>,
    teams: TeamRepositoryImpl,
) -> EnterpriseServiceType {
    EnterpriseService::new(
        enterprise::outbound::PgEnterpriseRepository::new(pool.clone()),
        EnterpriseTeams(teams),
        FusionAuthLifecycle(auth_client),
        PgMemberDirectory(pool.clone()),
        ServerHarnessRevocation(PgHarnessRepo::new(pool)),
    )
}
