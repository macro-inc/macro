use entity_access::{
    domain::{models::TeamRole, ports::EntityAccessService, service::EntityAccessServiceImpl},
    outbound::PgAccessRepository,
};
use sqlx::PgPool;
use team_agents::{
    domain::ports::{AgentAccounts, TeamAgentRepository},
    outbound::pg_team_agents_repo::PgTeamAgentsRepo,
};
use teams::{domain::team_repo::TeamRepository, outbound::team_repo::TeamRepositoryImpl};

use super::{
    Authority, HashSet, MacroUserIdStr, ReadError, Scope, Uuid,
    signed::{Profile, SignedAuthority},
};

pub(super) struct PgAuthority {
    pool: PgPool,
    access: EntityAccessServiceImpl<PgAccessRepository>,
    agents: PgTeamAgentsRepo,
}

impl PgAuthority {
    pub(super) fn new(pool: PgPool) -> Self {
        Self {
            access: EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
            agents: PgTeamAgentsRepo::new(pool.clone()),
            pool,
        }
    }

    async fn active_agent(&self, scope: &Scope) -> Result<bool, ReadError> {
        Ok(self
            .agents
            .account_facts(&scope.agent)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?
            .is_some_and(|agent| agent.team_id == scope.team && agent.is_agent && agent.member))
    }
}

impl SignedAuthority for PgAuthority {
    async fn can_read_team(
        &self,
        viewer: &MacroUserIdStr<'static>,
        team: Uuid,
    ) -> Result<bool, ReadError> {
        let membership = self
            .access
            .get_user_team(&viewer.0)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        Ok(membership
            .is_some_and(|current| current.team_id == team && current.role >= TeamRole::Admin))
    }

    async fn human_key(&self, viewer: &MacroUserIdStr<'static>) -> Result<Option<Uuid>, ReadError> {
        let key = sqlx::query_scalar!(
            r#"SELECT macro_user_id FROM "User" WHERE id = $1 AND NOT "isAgent""#,
            viewer.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| ReadError::AuthorityFailed)?;
        let Some(key) = key else {
            return Ok(None);
        };

        let account = self
            .agents
            .account_for_opaque_key(key)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        Ok((account.as_ref() == Some(viewer)).then_some(key))
    }

    async fn active_agent_key(
        &self,
        key: Uuid,
        team: Uuid,
    ) -> Result<Option<MacroUserIdStr<'static>>, ReadError> {
        let selected = self
            .agents
            .facts_for_opaque_key(key)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        Ok(selected
            .filter(|(_, facts)| facts.team_id == team && facts.is_agent && facts.member)
            .map(|(account, _)| account))
    }

    async fn profile(&self, scope: &Scope) -> Result<Option<Profile>, ReadError> {
        let record = self
            .agents
            .get(&scope.agent)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        let Some(record) = record.filter(|record| record.team_id == scope.team) else {
            return Ok(None);
        };
        let team_name = TeamRepositoryImpl::new(self.pool.clone())
            .get_team_name(&scope.team)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;

        Ok(Some(Profile {
            name: record.persona_seed.name,
            role: "Agent teammate".to_owned(),
            team_name,
            lifecycle: "Unavailable".to_owned(),
        }))
    }
}

impl Authority for PgAuthority {
    async fn can_read(
        &self,
        viewer: &MacroUserIdStr<'static>,
        scope: &Scope,
    ) -> Result<bool, ReadError> {
        if !self.can_read_team(viewer, scope.team).await? {
            return Ok(false);
        }
        self.active_agent(scope).await
    }

    async fn visible_documents(
        &self,
        viewer: &MacroUserIdStr<'static>,
        ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, ReadError> {
        let requested: Vec<_> = ids.iter().map(ToString::to_string).collect();
        // A retained access grant cannot establish that its source still exists.
        let live = sqlx::query_scalar!(
            r#"SELECT id FROM "Document" WHERE id = ANY($1) AND "deletedAt" IS NULL"#,
            &requested,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| ReadError::AuthorityFailed)?;
        let authorized = self
            .access
            .generate_document_view_access_receipts(&viewer.0, &live)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        Ok(ids
            .iter()
            .copied()
            .zip(requested)
            .filter_map(|(id, key)| authorized.contains_key(&key).then_some(id))
            .collect())
    }
}
