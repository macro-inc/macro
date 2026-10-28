//! Translate owning-domain facts and access receipts into the import domain policy.

use std::collections::HashSet;

use channels::{
    domain::models::{ChannelType, ParticipantRole},
    outbound::pg_channels_repo::historical,
};
use entity_access::domain::{
    models::{AccessError, AdminTeamRole, EntityType},
    ports::EntityAccessService,
};
use import::{domain::models::ImportTargetKey, outbound::pg_import_repo::targets};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use slack_integration::domain::{
    importer::targets::{TargetAccess, TargetFacts, TargetKind, authorize_target},
    models::*,
    ports::{ImportAuthorizer, PortResult},
};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::{ledger_error, retry, target_key, target_kind};

/// Authorization through current team-admin receipts and locked owning-crate facts.
#[derive(Clone)]
pub struct WorkerAuthorizer<A> {
    pool: PgPool,
    access: A,
}

impl<A: EntityAccessService> WorkerAuthorizer<A> {
    /// The access service is constructed by the application's composition root.
    pub fn new(pool: PgPool, access: A) -> Self {
        Self { pool, access }
    }

    pub(super) async fn target_in(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        key: &ImportTargetKey,
        user: &MacroUserIdStr<'_>,
        kind: ConversationKind,
        channel: Uuid,
        required_reservation: bool,
    ) -> PortResult<TargetFacts> {
        let team = key.team_id.try_into().map_err(retry)?;
        let prior =
            targets::lock_target_in(tx, key, channel, target_kind(kind), required_reservation)
                .await
                .map_err(ledger_error)?;
        self.require_admin(team, user).await?;
        let (facts, access) = inspect(tx, channel, Some(user))
            .await?
            .ok_or(ImportError::Unavailable)?;
        authorize_target(team, kind, &facts, prior, access)?;
        Ok(facts)
    }
}

impl<A: EntityAccessService> ImportAuthorizer for WorkerAuthorizer<A> {
    async fn require_admin(&self, team: TeamId, user: &MacroUserIdStr<'_>) -> PortResult<()> {
        self.access
            .generate_entity_access_receipt::<AdminTeamRole>(
                &user.0,
                None,
                &Uuid::from(team).to_string(),
                EntityType::Team,
            )
            .await
            .map_err(|error| match error {
                AccessError::Unauthorized => ImportError::Unavailable.into(),
                other => retry(other),
            })?;
        Ok(())
    }

    async fn require_target(
        &self,
        team: TeamId,
        user: &MacroUserIdStr<'_>,
        metadata: &ConversationMetadata,
        target: Uuid,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(retry)?;
        self.target_in(
            &mut tx,
            &target_key(team, &metadata.slack_channel_id)?,
            user,
            metadata.kind,
            target,
            false,
        )
        .await?;
        tx.commit().await.map_err(retry)
    }
}

pub(super) async fn inspect(
    tx: &mut Transaction<'_, Postgres>,
    channel: Uuid,
    requester: Option<&MacroUserIdStr<'_>>,
) -> PortResult<Option<(TargetFacts, TargetAccess)>> {
    let Some(facts) = historical::inspect_in(tx, channel, requester)
        .await
        .map_err(retry)?
    else {
        return Ok(None);
    };
    let kind = match facts.kind {
        ChannelType::Team => TargetKind::Team(
            facts
                .team
                .ok_or(ImportError::Unavailable)?
                .try_into()
                .map_err(retry)?,
        ),
        ChannelType::Private => TargetKind::Private,
        ChannelType::DirectMessage => TargetKind::DirectMessage,
        ChannelType::Public => TargetKind::Public,
    };
    let mut access = TargetAccess::None;
    let mut dm_members = HashSet::new();
    for participant in facts.participants {
        if requester.is_some_and(|user| participant.user_id == user.as_ref())
            && participant.left_at.is_none()
        {
            access = match participant.role {
                ParticipantRole::Owner | ParticipantRole::Admin => TargetAccess::ManageParticipants,
                ParticipantRole::Member => TargetAccess::Participant,
            };
        }
        if kind == TargetKind::DirectMessage {
            dm_members.insert(
                MacroUserIdStr::parse_from_str(&participant.user_id)
                    .map_err(retry)?
                    .into_owned(),
            );
        }
    }
    Ok(Some((
        TargetFacts {
            id: channel,
            kind,
            dm_members,
        },
        access,
    )))
}
