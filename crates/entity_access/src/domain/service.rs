//! Entity access service implementation.

use std::{collections::HashMap, marker::PhantomData, str::FromStr};

use crate::domain::{
    models::{
        AccessError, AccessLevel, AgentSessionParent, BotAccessScope, BotId, CallChannelInfo,
        ChannelRoleResult, CrmEntityAccess, Entity, EntityAccessAuth, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo, ViewAccessLevel,
    },
    ports::{
        AccessRepository, AccessibleDatabases, AccessibleForms, EntityAccessService,
        ScheduledActionGrants,
    },
};
use futures::{StreamExt, stream};
use macro_user_id::{
    cowlike::CowLike, lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr,
};
use uuid::Uuid;

const MAX_CONCURRENT_BATCH_ACCESS_CHECKS: usize = 8;

/// Implementation of the [`EntityAccessService`].
///
/// This service orchestrates access checks by:
/// 1. Delegating to [`AccessRepository`] for database queries
/// 2. Applying business rules (owner always has access, etc.)
#[derive(Clone)]
pub struct EntityAccessServiceImpl<R> {
    repo: R,
}

impl<R> EntityAccessServiceImpl<R>
where
    R: AccessRepository,
{
    /// Create a new entity access service.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    /// Get access level for entity types with dedicated repository queries.
    async fn get_optimized_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        match entity_type {
            EntityType::Document => self.repo.get_document_access(entity_id, user_id).await,
            EntityType::Chat => self.repo.get_chat_access(entity_id, user_id).await,
            EntityType::Project => self.repo.get_project_access(entity_id, user_id).await,
            EntityType::EmailThread => self.repo.get_thread_access(entity_id, user_id).await,
            EntityType::Call => self.repo.get_call_access(entity_id, user_id).await,
            EntityType::AgentSession => {
                let direct = self
                    .repo
                    .get_agent_session_access(entity_id, user_id)
                    .await?;
                let parent_access = match self.repo.get_agent_session_parent(entity_id).await? {
                    Some(AgentSessionParent::Document(document)) => {
                        self.repo.get_document_access(&document, user_id).await?
                    }
                    // Call history and chat require sign-in, including public
                    // call links. Their sessions inherit the same boundary.
                    Some(AgentSessionParent::Call(call_id)) if user_id.is_some() => {
                        self.repo
                            .get_call_access(&call_id.to_string(), user_id)
                            .await?
                    }
                    Some(AgentSessionParent::Call(_)) | None => None,
                };
                Ok(direct.max(parent_access.map(session_permission_from_parent)))
            }
            EntityType::Initiative => self.repo.get_initiative_access(entity_id, user_id).await,
            EntityType::Database => self.repo.get_database_access(entity_id, user_id).await,
            EntityType::DatabaseRow => self.repo.get_database_row_access(entity_id, user_id).await,
            EntityType::Form => self.repo.get_form_access(entity_id, user_id).await,
            EntityType::ScheduledAction => {
                self.repo
                    .get_scheduled_action_access(entity_id, user_id)
                    .await
            }
            EntityType::CalendarEvent => {
                self.repo
                    .get_calendar_event_access(entity_id, user_id)
                    .await
            }
            _ => unreachable!("Only optimized types should call this method"),
        }
    }

    /// Get access level for a channel.
    ///
    /// Channel access is binary - members get View access, non-members get None.
    async fn get_channel_access(
        &self,
        channel_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let channel_uuid = Uuid::from_str(channel_id)
            .map_err(|_| AccessError::BadRequest("Invalid channel ID format"))?;

        let user_channels = self
            .repo
            .check_user_channel_membership(user_id, &[channel_uuid])
            .await?;

        if user_channels.contains(&channel_uuid) {
            Ok(Some(AccessLevel::View))
        } else {
            Ok(None)
        }
    }

    /// Get access level for a foreign entity.
    ///
    /// Foreign entity access is binary and always maps to View access.
    async fn get_foreign_entity_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let has_access = self
            .repo
            .has_foreign_entity_access(entity_id, user_id)
            .await?;

        if has_access {
            Ok(Some(AccessLevel::View))
        } else {
            Ok(None)
        }
    }

    /// Get access level + owning team for a CRM company via the user's team
    /// membership.
    async fn get_crm_company_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        self.repo.get_crm_company_access(entity_id, user_id).await
    }

    /// Get access level + owning team for a CRM contact via its parent
    /// company's team.
    async fn get_crm_contact_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        self.repo.get_crm_contact_access(entity_id, user_id).await
    }

    /// Resolve a call id string to the channel id that owns it.
    ///
    /// Looks up both the active `calls` table and the archived `call_records`
    /// table. Returns `NotFound` if neither has a matching row, or
    /// `BadRequest` if the id is not a valid UUID.
    async fn resolve_call_channel_id(&self, call_id: &str) -> Result<Option<Uuid>, AccessError> {
        let call_uuid = Uuid::from_str(call_id)
            .map_err(|_| AccessError::BadRequest("Invalid call ID format"))?;
        let info = self
            .repo
            .get_call_channel(&call_uuid)
            .await?
            .ok_or(AccessError::NotFound("Call not found"))?;
        Ok(info.channel_id)
    }

    async fn get_user_scope_permission(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityPermission, AccessError> {
        if entity_type != EntityType::Team {
            return self
                .get_entity_permission(Some(user_id), entity_id, entity_type, user_org_id)
                .await;
        }
        self.get_team_permission(user_id, entity_id).await
    }

    async fn get_team_permission(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        entity_id: &str,
    ) -> Result<EntityPermission, AccessError> {
        let requested_team_id = Uuid::parse_str(entity_id)
            .map_err(|_| AccessError::BadRequest("Invalid team ID format"))?;
        let user_team = self
            .repo
            .get_user_team(user_id)
            .await?
            .filter(|team| team.team_id == requested_team_id)
            .ok_or(AccessError::Unauthorized)?;

        Ok(EntityPermission::TeamRole {
            role: user_team.role,
        })
    }

    async fn get_team_scope_permission(
        &self,
        bot_id: BotId,
        team_id: Uuid,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityPermission, AccessError> {
        match entity_type {
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread
            | EntityType::Call
            | EntityType::Initiative
            | EntityType::Database
            | EntityType::DatabaseRow
            | EntityType::Form => {
                let access_level = self
                    .repo
                    .get_team_entity_access(bot_id, team_id, entity_id, entity_type)
                    .await?
                    .ok_or(AccessError::Unauthorized)?;
                Ok(EntityPermission::AccessLevel { access_level })
            }
            EntityType::AgentSession => {
                let direct = self.repo.get_team_entity_access(bot_id, team_id, entity_id, entity_type).await?;
                let inherited = if let Some(parent) = self.repo.get_agent_session_parent(entity_id).await? {
                    let parent: Entity = parent.into();
                    self.repo.get_team_entity_access(bot_id, team_id, &parent.entity_id, parent.entity_type).await?.map(session_permission_from_parent)
                } else { None };
                Ok(EntityPermission::AccessLevel { access_level: direct.max(inherited).ok_or(AccessError::Unauthorized)? })
            }
            EntityType::Channel => {
                let channel_id = Uuid::parse_str(entity_id)
                    .map_err(|_| AccessError::BadRequest("Invalid channel ID format"))?;
                let role = self
                    .repo
                    .get_team_channel_role(&channel_id, team_id, bot_id)
                    .await?;
                channel_role_result_to_permission(role)
            }
            EntityType::ForeignEntity => {
                let has_access = self
                    .repo
                    .has_team_foreign_entity_access(entity_id, team_id, bot_id)
                    .await?;
                if has_access {
                    Ok(EntityPermission::AccessLevel {
                        access_level: AccessLevel::View,
                    })
                } else {
                    Err(AccessError::Unauthorized)
                }
            }
            EntityType::CrmCompany => {
                self.repo
                    .get_team_crm_company_access(entity_id, team_id)
                    .await?
                    .ok_or(AccessError::Unauthorized)?;
                Ok(EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                })
            }
            EntityType::CrmContact => {
                self.repo
                    .get_team_crm_contact_access(entity_id, team_id)
                    .await?
                    .ok_or(AccessError::Unauthorized)?;
                Ok(EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                })
            }
            EntityType::Team => {
                let requested_team_id = Uuid::parse_str(entity_id)
                    .map_err(|_| AccessError::BadRequest("Invalid team ID format"))?;
                if requested_team_id != team_id {
                    return Err(AccessError::Unauthorized);
                }
                Ok(EntityPermission::TeamRole {
                    role: TeamRole::Member,
                })
            }
            EntityType::User
            | EntityType::ChannelMessage
            | EntityType::StaticFile
            | EntityType::CalendarEvent
            // A reminder belongs to a user, so a team-scoped bot never reaches one.
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::ScheduledAction => {
                Err(AccessError::BadRequest("Unsupported bot entity type"))
            }
        }
    }
}

impl<R> AccessibleDatabases for EntityAccessServiceImpl<R>
where
    R: AccessRepository,
{
    #[tracing::instrument(err, skip(self))]
    async fn accessible_databases(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<(Uuid, AccessLevel)>, AccessError> {
        self.repo.list_database_access(user_id).await
    }
}

impl<R> AccessibleForms for EntityAccessServiceImpl<R>
where
    R: AccessRepository,
{
    #[tracing::instrument(err, skip(self))]
    async fn accessible_forms(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<(Uuid, AccessLevel)>, AccessError> {
        self.repo.list_form_access(user_id).await
    }
}

impl<R> EntityAccessService for EntityAccessServiceImpl<R>
where
    R: AccessRepository,
{
    #[tracing::instrument(err, skip(self))]
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let entity_permission = self
            .get_entity_permission(Some(user_id), entity_id, entity_type, user_org_id)
            .await?;

        if !entity_permission.satisfies::<T>() {
            return Err(AccessError::Unauthorized);
        }

        Ok(EntityAccessReceipt {
            auth: EntityAccessAuth::Authenticated(MacroUserIdStr(user_id.clone().into_owned())),
            entity: Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            entity_permission,
            _marker: PhantomData,
        })
    }

    #[tracing::instrument(skip_all, fields(row_count = row_ids.len()))]
    async fn generate_database_row_view_access_receipts(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        row_ids: &[String],
    ) -> HashMap<String, Result<EntityAccessReceipt<ViewAccessLevel>, AccessError>> {
        let mut receipts = HashMap::with_capacity(row_ids.len());
        let mut valid_ids = Vec::with_capacity(row_ids.len());
        for row_id in row_ids {
            match Uuid::parse_str(row_id) {
                Ok(id) => valid_ids.push((row_id, id)),
                Err(_) => {
                    receipts.insert(
                        row_id.clone(),
                        Err(AccessError::BadRequest("Invalid database row ID format")),
                    );
                }
            }
        }
        if valid_ids.is_empty() {
            return receipts;
        }
        let levels = match self
            .repo
            .get_database_rows_access(
                &valid_ids.iter().map(|(_, id)| *id).collect::<Vec<_>>(),
                user_id,
            )
            .await
        {
            Ok(levels) => levels,
            Err(error) => {
                tracing::error!(?error, "bulk database row access check failed");
                for (row_id, _) in valid_ids {
                    receipts.insert(
                        row_id.clone(),
                        Err(AccessError::internal(
                            "bulk database row access check failed",
                        )),
                    );
                }
                return receipts;
            }
        };
        for (row_id, id) in valid_ids {
            let receipt = levels
                .get(&id)
                .ok_or(AccessError::Unauthorized)
                .and_then(|level| {
                    EntityAccessReceipt::try_new_authenticated_user(
                        MacroUserIdStr(user_id.clone().into_owned()),
                        Entity {
                            entity_id: row_id.clone(),
                            entity_type: EntityType::DatabaseRow,
                        },
                        EntityPermission::AccessLevel {
                            access_level: *level,
                        },
                    )
                });
            receipts.insert(row_id.clone(), receipt);
        }
        receipts
    }

    async fn generate_email_thread_view_access_receipts(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        thread_ids: &[String],
    ) -> HashMap<String, Result<EntityAccessReceipt<ViewAccessLevel>, AccessError>> {
        let mut receipts = HashMap::with_capacity(thread_ids.len());
        let mut valid_ids = Vec::with_capacity(thread_ids.len());

        for thread_id in thread_ids {
            match Uuid::parse_str(thread_id) {
                Ok(id) => valid_ids.push((thread_id.clone(), id)),
                Err(_) => {
                    receipts.insert(
                        thread_id.clone(),
                        Err(AccessError::BadRequest("Invalid thread ID format")),
                    );
                }
            }
        }

        let owned_ids = match self
            .repo
            .get_owned_email_thread_ids(
                &valid_ids.iter().map(|(_, id)| *id).collect::<Vec<_>>(),
                user_id,
            )
            .await
        {
            Ok(ids) => ids.into_iter().collect::<std::collections::HashSet<_>>(),
            Err(error) => {
                tracing::error!(?error, "bulk email thread ownership check failed");
                for (thread_id, _) in valid_ids {
                    receipts.insert(
                        thread_id,
                        Err(AccessError::internal(
                            "bulk email thread ownership check failed",
                        )),
                    );
                }
                return receipts;
            }
        };

        let mut remaining = Vec::new();
        for (thread_id, id) in valid_ids {
            if owned_ids.contains(&id) {
                receipts.insert(
                    thread_id.clone(),
                    Ok(EntityAccessReceipt {
                        auth: EntityAccessAuth::Authenticated(MacroUserIdStr(
                            user_id.clone().into_owned(),
                        )),
                        entity: Entity {
                            entity_id: thread_id,
                            entity_type: EntityType::EmailThread,
                        },
                        entity_permission: EntityPermission::AccessLevel {
                            access_level: AccessLevel::Owner,
                        },
                        _marker: PhantomData,
                    }),
                );
            } else {
                remaining.push(thread_id);
            }
        }

        let fallback = stream::iter(remaining.into_iter().map(|thread_id| async move {
            let result = self
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    user_id,
                    user_org_id,
                    &thread_id,
                    EntityType::EmailThread,
                )
                .await;
            (thread_id, result)
        }))
        .buffer_unordered(MAX_CONCURRENT_BATCH_ACCESS_CHECKS)
        .collect::<Vec<_>>()
        .await;
        receipts.extend(fallback);
        receipts
    }

    #[tracing::instrument(err, skip(self))]
    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let entity_permission = match &scope {
            BotAccessScope::User {
                user_id,
                user_org_id,
            } => {
                self.get_user_scope_permission(user_id, *user_org_id, entity_id, entity_type)
                    .await?
            }
            BotAccessScope::Team { team_id } => {
                self.get_team_scope_permission(bot_id, *team_id, entity_id, entity_type)
                    .await?
            }
        };

        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            entity_permission,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        match entity_type {
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread
            | EntityType::Call
            | EntityType::CalendarEvent
            | EntityType::AgentSession
            | EntityType::Initiative
            | EntityType::Database
            | EntityType::DatabaseRow
            | EntityType::Form
            | EntityType::ScheduledAction => {
                self.get_optimized_access(entity_id, user_id, entity_type)
                    .await
            }
            EntityType::Channel => self.get_channel_access(entity_id, user_id).await,
            EntityType::Reminder => self.repo.get_reminder_access(entity_id, user_id).await,
            EntityType::ForeignEntity => self.get_foreign_entity_access(entity_id, user_id).await,
            EntityType::CrmCompany => Ok(self
                .get_crm_company_access(entity_id, user_id)
                .await?
                .map(|a| a.access_level)),
            EntityType::CrmContact => Ok(self
                .get_crm_contact_access(entity_id, user_id)
                .await?
                .map(|a| a.access_level)),
            // Static files are always viewable. This is wrong for owners
            EntityType::StaticFile => Ok(Some(AccessLevel::View)),
            // These entity types either don't have access checks implemented yet, or they should not have access checks.
            // Skill refs are access-checked against the underlying skill document.
            EntityType::Team
            | EntityType::User
            | EntityType::ChannelMessage
            | EntityType::Skill => Ok(None),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_access(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        let access_level = self
            .get_access_level(user_id, entity_id, entity_type)
            .await?;

        match access_level {
            Some(level) if level >= required_level => Ok(level),
            Some(_) => Err(AccessError::Unauthorized),
            None => Err(AccessError::Unauthorized),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        let access_level = self.get_access_level(None, entity_id, entity_type).await?;

        match access_level {
            Some(level) if level >= required_level => Ok(level),
            Some(_) | None => Err(AccessError::Unauthorized),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        match entity_type {
            EntityType::Team => {
                let user_id = user_id.ok_or(AccessError::Unauthorized)?;
                self.get_team_permission(user_id, entity_id).await
            }
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread
            | EntityType::Call
            | EntityType::CalendarEvent
            | EntityType::AgentSession
            | EntityType::Initiative
            | EntityType::Database
            | EntityType::DatabaseRow
            | EntityType::Form
            | EntityType::ScheduledAction => {
                let access = self
                    .get_optimized_access(entity_id, user_id, entity_type)
                    .await?;
                match access {
                    Some(level) => Ok(EntityPermission::AccessLevel {
                        access_level: level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::ForeignEntity => {
                let access = self.get_foreign_entity_access(entity_id, user_id).await?;
                match access {
                    Some(level) => Ok(EntityPermission::AccessLevel {
                        access_level: level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::CrmCompany => {
                let access = self.get_crm_company_access(entity_id, user_id).await?;
                match access {
                    Some(access) => Ok(EntityPermission::AccessLevel {
                        access_level: access.access_level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::CrmContact => {
                let access = self.get_crm_contact_access(entity_id, user_id).await?;
                match access {
                    Some(access) => Ok(EntityPermission::AccessLevel {
                        access_level: access.access_level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::Channel => {
                let channel_uuid = Uuid::from_str(entity_id)
                    .map_err(|_| AccessError::BadRequest("Invalid channel ID format"))?;

                let result = self
                    .repo
                    .get_channel_role(&channel_uuid, user_id, user_org_id)
                    .await?;
                channel_role_result_to_permission(result)
            }
            // Ownership is the whole access model, so the only level this can
            // yield is `Owner` — a caller who is not the owner gets no row.
            // `ReminderAccessExtractor` builds the same receipt straight from
            // `get_access_level`; this arm is what lets a non-axum caller (an
            // AI tool) mint one without reimplementing that.
            EntityType::Reminder => {
                let access = self.repo.get_reminder_access(entity_id, user_id).await?;
                match access {
                    Some(access_level) => Ok(EntityPermission::AccessLevel { access_level }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            _ => Err(AccessError::BadRequest("Unsupported entity type")),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_crm_entity_permission_with_team(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        // Resolve permission, owning team, and team role from one ownership
        // lookup, so the team is the entity's owner (and the user is a member
        // of it) rather than the user's default team.
        let access = match entity_type {
            EntityType::CrmCompany => self.get_crm_company_access(entity_id, user_id).await?,
            EntityType::CrmContact => self.get_crm_contact_access(entity_id, user_id).await?,
            _ => {
                return Err(AccessError::BadRequest(
                    "get_crm_entity_permission_with_team supports only CRM entities",
                ));
            }
        };
        let access = access.ok_or(AccessError::Unauthorized)?;
        Ok((
            EntityPermission::AccessLevel {
                access_level: access.access_level,
            },
            access.team_id,
            access.team_role,
        ))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        match entity_type {
            // Agent sessions grant their owner directly and their originating
            // channel as a channel source, both of which the generic accessor
            // query expands.
            // A database's audience is exactly its `entity_access` rows, so it
            // resolves the same way a document's does. So is a form's: a public
            // audience is anyone with the link, which no list can name.
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread
            | EntityType::AgentSession
            | EntityType::Initiative
            | EntityType::CrmCompany
            | EntityType::CrmContact
            | EntityType::Database
            | EntityType::Form => {
                let entity_id = Uuid::parse_str(entity_id).map_err(|_| {
                    AccessError::BadRequest("invalid entity_id for get_users_by_entity")
                })?;

                self.repo.get_entity_users(&entity_id, entity_type).await
            }
            // A row's audience is its database's: rows carry no grants.
            EntityType::DatabaseRow => {
                let row_id = Uuid::parse_str(entity_id).map_err(|_| {
                    AccessError::BadRequest("invalid row_id for get_users_by_entity")
                })?;
                match self.repo.get_database_row_database(&row_id).await? {
                    Some(database_id) => {
                        self.repo
                            .get_entity_users(&database_id, EntityType::Database)
                            .await
                    }
                    None => Ok(Vec::new()),
                }
            }
            EntityType::Channel => {
                let channel_id = Uuid::parse_str(entity_id).map_err(|_| {
                    AccessError::BadRequest("invalid channel_id for get_users_by_entity")
                })?;
                self.repo.get_channel_users(&channel_id).await
            }
            EntityType::Call => match self.resolve_call_channel_id(entity_id).await? {
                Some(channel_id) => self.repo.get_channel_users(&channel_id).await,
                None => {
                    let call_id = Uuid::parse_str(entity_id).map_err(|_| {
                        AccessError::BadRequest("invalid call_id for get_users_by_entity")
                    })?;
                    self.repo
                        .get_direct_entity_users(&call_id, EntityType::Call)
                        .await
                }
            },
            _ => Err(AccessError::BadRequest(
                "get_users_by_entity does not support this entity type",
            )),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        self.repo.get_call_channel(call_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        self.repo.get_call_channel_by_channel_id(channel_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        self.repo.get_user_team(user_id).await
    }
}

impl<R: AccessRepository> ScheduledActionGrants for EntityAccessServiceImpl<R> {
    async fn accessible_scheduled_action_ids(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<Uuid>, AccessError> {
        self.repo.accessible_scheduled_action_ids(user_id).await
    }
}

fn channel_role_result_to_permission(
    result: ChannelRoleResult,
) -> Result<EntityPermission, AccessError> {
    match result {
        ChannelRoleResult::Role(role) => Ok(EntityPermission::ChannelRole { role }),
        ChannelRoleResult::ViewOnly => Ok(EntityPermission::ChannelViewOnly),
        ChannelRoleResult::NoAccess => Err(AccessError::Unauthorized),
        ChannelRoleResult::NotFound => Err(AccessError::NotFound("Channel not found")),
    }
}

#[cfg(test)]
mod test;

// Commenters can prompt the agent; viewers can inspect the response. Parent
// ownership never confers session ownership or permission to delete it.
fn session_permission_from_parent(level: AccessLevel) -> AccessLevel {
    if level >= AccessLevel::Comment {
        AccessLevel::Edit
    } else {
        AccessLevel::View
    }
}
