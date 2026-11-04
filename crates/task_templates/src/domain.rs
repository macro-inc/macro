//! Task-template content, authorization, and persistence ports.
use chrono::{DateTime, Utc};
use models_properties::api::SetPropertyValue;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, future::Future};
use utoipa::ToSchema;
use uuid::Uuid;

const MAX_PROPERTIES: usize = 64;
const MAX_DESCRIPTION_BYTES: usize = 16_384;
const MAX_CONFIGURATION_BYTES: usize = 32_768;
const MAX_NAME_CHARACTERS: usize = 120;

/// A reusable default using the task creation property's existing value contract.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PropertyDefault {
    /// Definition that receives the default.
    pub property_id: Uuid,
    /// Default value; absence from the configuration leaves the field blank.
    pub value: SetPropertyValue,
}

/// Selected fields, optional default values, and description Markdown.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskTemplateConfiguration {
    /// Visible definition IDs, including fields without a default value.
    pub property_ids: Vec<Uuid>,
    /// Defaults for selected fields only.
    #[serde(default)]
    pub defaults: Vec<PropertyDefault>,
    /// Markdown inserted only when the current description is blank.
    pub description_markdown: String,
}

impl TaskTemplateConfiguration {
    fn validate(&mut self) -> Result<(), Error> {
        if self.property_ids.len() > MAX_PROPERTIES
            || self.defaults.len() > MAX_PROPERTIES
            || self.description_markdown.len() > MAX_DESCRIPTION_BYTES
        {
            return Err(Error::Invalid);
        }
        let mut ids = HashSet::new();
        self.property_ids.retain(|id| ids.insert(*id));
        let mut defaults = HashSet::new();
        if self
            .defaults
            .iter()
            .any(|item| !ids.contains(&item.property_id) || !defaults.insert(item.property_id))
            || serde_json::to_vec(self).map_err(|_| Error::Invalid)?.len() > MAX_CONFIGURATION_BYTES
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

/// A personal or team-owned template with viewer-specific management capability.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskTemplate {
    /// Stable template ID.
    pub id: Uuid,
    /// Personal owner; absent for team-owned templates.
    pub user_id: Option<String>,
    /// Owning team; absent for personal templates.
    pub team_id: Option<Uuid>,
    /// Original creator; cleared when that account is deleted.
    pub creator_id: Option<String>,
    /// User-supplied template name.
    pub name: String,
    /// Reusable task fields and description.
    pub configuration: TaskTemplateConfiguration,
    /// Positive revision used for conditional updates and deletes.
    pub revision: i64,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last content update time.
    pub updated_at: DateTime<Utc>,
    /// Whether the current viewer can update or delete the template.
    pub can_manage: bool,
}

/// Create a personal template or one owned by a current team.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTaskTemplateRequest {
    /// Client-generated creation identity; reuse the same ID and input when retrying.
    pub id: Option<Uuid>,
    /// Owning team; omission creates a personal template.
    pub team_id: Option<Uuid>,
    /// Template name.
    pub name: String,
    /// Reusable task fields and description.
    pub configuration: TaskTemplateConfiguration,
}

/// Replace content without changing ownership.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTaskTemplateRequest {
    /// Revision observed when editing began.
    pub revision: i64,
    /// Replacement name.
    pub name: String,
    /// Replacement task fields and description.
    pub configuration: TaskTemplateConfiguration,
}

/// Current Teams-owned membership facts relevant to template management.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamAccess {
    /// A current team member.
    Member,
    /// A current team admin or owner.
    Admin,
}

/// Current membership evidence supplied by the Teams domain at composition.
pub trait Membership: Send + Sync {
    /// Membership lookup failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Read the actor's current role from primary storage.
    fn access(
        &self,
        user: &str,
        team: Uuid,
    ) -> impl Future<Output = Result<Option<TeamAccess>, Self::Err>> + Send;
}

/// Template storage; authorization belongs to the domain service.
pub trait Repository: Send + Sync {
    /// Persistence failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// List personal records and records for the authorized team.
    fn list(
        &self,
        user: &str,
        team: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<TaskTemplate>, Self::Err>> + Send;
    /// Load one record for the service's access check.
    fn get(&self, id: Uuid)
    -> impl Future<Output = Result<Option<TaskTemplate>, Self::Err>> + Send;
    /// Insert a new record without replacing an existing ID.
    fn create(
        &self,
        template: &TaskTemplate,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Replace content only while the expected revision still matches.
    fn update(
        &self,
        template: &TaskTemplate,
        expected: i64,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Delete only while the expected revision still matches.
    fn delete(
        &self,
        template: &TaskTemplate,
        expected: i64,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Caller-meaningful task-template failures.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Missing record or one the actor cannot manage.
    #[error("task template not found")]
    NotFound,
    /// Team creation or listing requires current membership.
    #[error("not a current team member")]
    Forbidden,
    /// Another write replaced the revision submitted by the actor.
    #[error("task template revision conflict")]
    Conflict,
    /// Invalid or oversized configuration.
    #[error("invalid task template input")]
    Invalid,
    /// Storage or membership failure, retained without exposing content to clients.
    #[error("task template operation failed")]
    Internal(rootcause::Report),
}

/// Personal ownership and current-team management policy.
pub struct Service<R, M> {
    repository: R,
    membership: M,
}

fn can_manage(template: &TaskTemplate, user: &str, role: Option<TeamAccess>) -> bool {
    if template.team_id.is_none() {
        return template.user_id.as_deref() == Some(user);
    }
    role.is_some()
        && (template.creator_id.as_deref() == Some(user) || role == Some(TeamAccess::Admin))
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> Error {
    Error::Internal(rootcause::Report::new(error).into_dynamic())
}

impl<R: Repository, M: Membership> Service<R, M> {
    /// Compose persistence and authoritative membership evidence.
    pub fn new(repository: R, membership: M) -> Self {
        Self {
            repository,
            membership,
        }
    }

    async fn access(&self, user: &str, team: Uuid) -> Result<Option<TeamAccess>, Error> {
        self.membership.access(user, team).await.map_err(internal)
    }

    fn validate(name: &str, configuration: &mut TaskTemplateConfiguration) -> Result<(), Error> {
        if name.is_empty() || name.chars().count() > MAX_NAME_CHARACTERS {
            return Err(Error::Invalid);
        }
        configuration.validate()
    }

    /// List personal templates and templates for one currently joined team.
    #[tracing::instrument(skip_all, err)]
    pub async fn list(&self, user: &str, team: Option<Uuid>) -> Result<Vec<TaskTemplate>, Error> {
        if let Some(team) = team
            && self.access(user, team).await?.is_none()
        {
            return Err(Error::Forbidden);
        }
        let mut templates = self.repository.list(user, team).await.map_err(internal)?;
        let role = if let Some(team) = team {
            self.access(user, team).await?
        } else {
            None
        };
        templates.retain(|item| {
            item.user_id.as_deref() == Some(user)
                || (item.team_id.is_some() && item.team_id == team && role.is_some())
        });
        for item in &mut templates {
            item.can_manage = can_manage(item, user, role);
        }
        Ok(templates)
    }

    /// Create a personal template or a team-owned template while currently joined.
    #[tracing::instrument(skip_all, err)]
    pub async fn create(
        &self,
        user: &str,
        mut input: CreateTaskTemplateRequest,
    ) -> Result<TaskTemplate, Error> {
        input.name = input.name.trim().to_owned();
        Self::validate(&input.name, &mut input.configuration)?;
        if let Some(team) = input.team_id
            && self.access(user, team).await?.is_none()
        {
            return Err(Error::Forbidden);
        }
        let now = Utc::now();
        let template = TaskTemplate {
            id: input.id.unwrap_or_else(macro_uuid::generate_uuid_v7),
            user_id: input.team_id.is_none().then(|| user.to_owned()),
            team_id: input.team_id,
            creator_id: Some(user.to_owned()),
            name: input.name,
            configuration: input.configuration,
            revision: 1,
            created_at: now,
            updated_at: now,
            can_manage: true,
        };
        if !self.repository.create(&template).await.map_err(internal)? {
            let existing = self
                .repository
                .get(template.id)
                .await
                .map_err(internal)?
                .ok_or(Error::Conflict)?;
            if existing.creator_id.as_deref() != Some(user)
                || existing.user_id != template.user_id
                || existing.team_id != template.team_id
                || existing.name != template.name
                || serde_json::to_value(&existing.configuration).map_err(internal)?
                    != serde_json::to_value(&template.configuration).map_err(internal)?
            {
                return Err(Error::Conflict);
            }
        }
        self.managed(user, template.id).await
    }

    /// Read a personal template or a template owned by a currently joined team.
    #[tracing::instrument(skip_all, fields(template_id = %id), err)]
    pub async fn get(&self, user: &str, id: Uuid) -> Result<TaskTemplate, Error> {
        let mut template = self
            .repository
            .get(id)
            .await
            .map_err(internal)?
            .ok_or(Error::NotFound)?;
        let role = if let Some(team) = template.team_id {
            let role = self.access(user, team).await?;
            if role.is_none() {
                return Err(Error::NotFound);
            }
            role
        } else {
            if template.user_id.as_deref() != Some(user) {
                return Err(Error::NotFound);
            }
            None
        };
        template.can_manage = can_manage(&template, user, role);
        Ok(template)
    }

    async fn managed(&self, user: &str, id: Uuid) -> Result<TaskTemplate, Error> {
        let template = self.get(user, id).await?;
        if !template.can_manage {
            return Err(Error::NotFound);
        }
        Ok(template)
    }

    /// Replace a managed template at the revision observed by the caller.
    #[tracing::instrument(skip_all, fields(template_id = %id), err)]
    pub async fn update(
        &self,
        user: &str,
        id: Uuid,
        mut input: UpdateTaskTemplateRequest,
    ) -> Result<TaskTemplate, Error> {
        if input.revision < 1 || input.revision == i64::MAX {
            return Err(Error::Invalid);
        }
        input.name = input.name.trim().to_owned();
        Self::validate(&input.name, &mut input.configuration)?;
        let mut template = self.managed(user, id).await?;
        if template.revision != input.revision {
            return Err(Error::Conflict);
        }
        template.name = input.name;
        template.configuration = input.configuration;
        if !self
            .repository
            .update(&template, input.revision)
            .await
            .map_err(internal)?
        {
            return Err(Error::Conflict);
        }
        self.managed(user, id).await
    }

    /// Delete a managed template without affecting tasks created from it.
    #[tracing::instrument(skip_all, fields(template_id = %id), err)]
    pub async fn delete(&self, user: &str, id: Uuid, revision: i64) -> Result<(), Error> {
        if revision < 1 {
            return Err(Error::Invalid);
        }
        let template = self.managed(user, id).await?;
        if template.revision != revision {
            return Err(Error::Conflict);
        }
        if !self
            .repository
            .delete(&template, revision)
            .await
            .map_err(internal)?
        {
            return Err(Error::Conflict);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
