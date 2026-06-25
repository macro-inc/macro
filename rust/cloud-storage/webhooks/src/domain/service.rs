//! The webhook service: create a webhook with its rule, validate a webhook
//! configuration, and patch an existing webhook and/or its rule.
//!
//! The service is generic over its ports so it can be unit-tested with
//! in-memory fakes (see `service/test.rs`). Resource-access enforcement is the
//! notable piece of business logic: before any rule is persisted, every
//! resource the rule positively filters on is checked against
//! [`EntityAccessService`], so a user cannot subscribe a webhook to channels (or
//! other entities) they cannot see.

#[cfg(test)]
mod test;

use std::collections::BTreeMap;
use std::future::Future;

use entity_access::domain::models::AccessError;
use entity_access::domain::ports::EntityAccessService;

use crate::domain::{
    ids::{WebhookId, WebhookRuleId},
    model::{
        CreateWebhookRequest, CreateWebhookResponse, PatchWebhookRequest, Webhook, WebhookActor,
        first_reserved_header,
    },
    ports::{
        EncryptionError, EndpointValidationError, EndpointValidator, NewRuleRecord,
        NewWebhookRecord, SecretEncryptor, WebhookFieldsPatch, WebhookRepoError, WebhookRepository,
    },
    rule::{RuleDefinition, RuleValidationError},
};

/// A normalized webhook configuration to validate: the destination URL plus the
/// typed rule definition. Used by [`WebhookService::validate_webhook`] and built
/// internally by create/patch.
#[derive(Debug, Clone)]
pub struct WebhookDraft {
    /// The candidate endpoint URL.
    pub endpoint_url: String,
    /// The candidate rule definition.
    pub rule: RuleDefinition,
}

/// The webhook configuration service.
pub trait WebhookService: Clone + Send + Sync + 'static {
    /// Create a webhook together with its single rule. Validates the endpoint
    /// and the rule (including resource access) before persisting. The response
    /// carries the generated signing secret exactly once.
    fn create_webhook(
        &self,
        actor: &WebhookActor,
        req: CreateWebhookRequest,
    ) -> impl Future<Output = Result<CreateWebhookResponse, CreateWebhookError>> + Send;

    /// Validate a webhook draft: the endpoint URL is safe, the rule is
    /// structurally valid, and the user has access to every resource the rule
    /// filters on. Does not persist anything.
    fn validate_webhook(
        &self,
        actor: &WebhookActor,
        draft: &WebhookDraft,
    ) -> impl Future<Output = Result<(), ValidateWebhookError>> + Send;

    /// Apply a partial update to an existing webhook and/or replace its rule.
    /// Re-validates anything that changed. Returns the updated webhook.
    fn patch_webhook(
        &self,
        actor: &WebhookActor,
        webhook_id: &WebhookId,
        req: PatchWebhookRequest,
    ) -> impl Future<Output = Result<Webhook, PatchWebhookError>> + Send;
}

/// Implementation of [`WebhookService`] over the repository, entity-access,
/// endpoint-validation, and secret-encryption ports.
#[derive(Debug, Clone)]
pub struct WebhookServiceImpl<R, Eas, V, Enc>
where
    R: WebhookRepository,
    Eas: EntityAccessService,
    V: EndpointValidator,
    Enc: SecretEncryptor,
{
    repository: R,
    entity_access_service: Eas,
    endpoint_validator: V,
    encryptor: Enc,
}

impl<R, Eas, V, Enc> WebhookServiceImpl<R, Eas, V, Enc>
where
    R: WebhookRepository,
    Eas: EntityAccessService,
    V: EndpointValidator,
    Enc: SecretEncryptor,
{
    /// Construct a new webhook service from its ports.
    pub fn new(
        repository: R,
        entity_access_service: Eas,
        endpoint_validator: V,
        encryptor: Enc,
    ) -> Self {
        Self {
            repository,
            entity_access_service,
            endpoint_validator,
            encryptor,
        }
    }

    /// Validate the endpoint URL via the endpoint-validation port.
    async fn validate_endpoint(&self, url: &str) -> Result<(), ValidateWebhookError> {
        self.endpoint_validator
            .validate(url)
            .await
            .map_err(ValidateWebhookError::InvalidEndpoint)
    }

    /// Validate the rule's structure and the caller's access to every resource
    /// it positively filters on.
    async fn validate_rule(
        &self,
        actor: &WebhookActor,
        rule: &RuleDefinition,
    ) -> Result<(), ValidateWebhookError> {
        rule.validate_structure()?;

        // `get_access_level` is the codebase's standard "can this user see this
        // entity" primitive; for channels it resolves to participant membership,
        // which is the access authority and is inherently tenant-scoped (a user
        // can only be a member of channels in their own org), so no org id is
        // threaded through here. It returns `Ok(None)` when the user cannot see
        // the resource (including when it does not exist); `Err` only for
        // database/internal failures.
        for resource in rule.resource_refs() {
            let access = self
                .entity_access_service
                .get_access_level(Some(&actor.user_id.0), &resource.id, resource.entity_type)
                .await
                .map_err(ValidateWebhookError::AccessCheck)?;

            if access.is_none() {
                return Err(ValidateWebhookError::ResourceForbidden {
                    entity: resource.entity_type.to_string(),
                    id: resource.id,
                    field: resource.field,
                });
            }
        }
        Ok(())
    }

    /// Validate custom headers and encrypt them for storage. Returns `None` when
    /// there are no headers to store. Rejects reserved header names.
    fn encrypt_headers(
        &self,
        headers: Option<&BTreeMap<String, String>>,
    ) -> Result<Option<Vec<u8>>, HeaderError> {
        match headers {
            Some(headers) if !headers.is_empty() => {
                if let Some(reserved) = first_reserved_header(headers) {
                    return Err(HeaderError::Reserved(reserved));
                }
                let json = serde_json::to_vec(headers).map_err(HeaderError::Serialize)?;
                Ok(Some(self.encryptor.encrypt(&json)?))
            }
            _ => Ok(None),
        }
    }
}

impl<R, Eas, V, Enc> WebhookService for WebhookServiceImpl<R, Eas, V, Enc>
where
    R: WebhookRepository,
    Eas: EntityAccessService,
    V: EndpointValidator,
    Enc: SecretEncryptor,
{
    #[tracing::instrument(skip(self, req), fields(workspace_id = %actor.workspace_id), err)]
    async fn create_webhook(
        &self,
        actor: &WebhookActor,
        req: CreateWebhookRequest,
    ) -> Result<CreateWebhookResponse, CreateWebhookError> {
        if req.name.trim().is_empty() {
            return Err(CreateWebhookError::BadRequest(
                "name must not be empty".into(),
            ));
        }

        let headers_encrypted = self.encrypt_headers(req.headers.as_ref())?;

        let definition = RuleDefinition::from_parts(
            req.rule.version,
            req.rule.events.clone(),
            req.rule.filters.clone(),
        );

        // Validate endpoint + rule + resource access before generating secrets
        // or touching the database.
        let draft = WebhookDraft {
            endpoint_url: req.endpoint_url.clone(),
            rule: definition.clone(),
        };
        self.validate_webhook(actor, &draft).await?;

        let signing_secret = self.encryptor.generate_secret();
        let secret_encrypted = self.encryptor.encrypt(signing_secret.as_bytes())?;

        let record = NewWebhookRecord {
            id: WebhookId::generate(),
            workspace_id: actor.workspace_id.clone(),
            owner_user_id: Some(actor.user_id.to_string()),
            name: req.name,
            endpoint_url: req.endpoint_url,
            secret_encrypted,
            headers_encrypted,
            created_by_user_id: actor.user_id.to_string(),
            rule: NewRuleRecord {
                id: WebhookRuleId::generate(),
                workspace_id: actor.workspace_id.clone(),
                name: req.rule.name,
                enabled: req.rule.enabled.unwrap_or(true),
                definition,
            },
        };

        let webhook = self.repository.create_webhook_with_rule(record).await?;
        Ok(CreateWebhookResponse {
            webhook,
            signing_secret,
        })
    }

    #[tracing::instrument(skip(self, draft), fields(workspace_id = %actor.workspace_id), err)]
    async fn validate_webhook(
        &self,
        actor: &WebhookActor,
        draft: &WebhookDraft,
    ) -> Result<(), ValidateWebhookError> {
        self.validate_endpoint(&draft.endpoint_url).await?;
        self.validate_rule(actor, &draft.rule).await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, req), fields(workspace_id = %actor.workspace_id, webhook_id = %webhook_id), err)]
    async fn patch_webhook(
        &self,
        actor: &WebhookActor,
        webhook_id: &WebhookId,
        req: PatchWebhookRequest,
    ) -> Result<Webhook, PatchWebhookError> {
        // Workspace-scoped load doubles as the ownership/existence check.
        let existing = self
            .repository
            .get_webhook(&actor.workspace_id, webhook_id)
            .await?
            .ok_or(PatchWebhookError::NotFound)?;
        let existing_rule_id = existing.rule.as_ref().map(|rule| rule.id.clone());

        // Re-validate only what changed.
        if let Some(url) = &req.endpoint_url {
            self.validate_endpoint(url)
                .await
                .map_err(PatchWebhookError::Validation)?;
        }

        let new_rule_def = match &req.rule {
            Some(input) => {
                let definition = RuleDefinition::from_parts(
                    input.version,
                    input.events.clone(),
                    input.filters.clone(),
                );
                self.validate_rule(actor, &definition)
                    .await
                    .map_err(PatchWebhookError::Validation)?;
                Some(definition)
            }
            None => None,
        };

        // Assemble the column-level patch.
        let mut patch = WebhookFieldsPatch::default();
        if let Some(name) = &req.name {
            if name.trim().is_empty() {
                return Err(PatchWebhookError::BadRequest(
                    "name must not be empty".into(),
                ));
            }
            patch.name = Some(name.clone());
        }
        patch.endpoint_url = req.endpoint_url.clone();
        patch.status = req.status;
        patch.headers_encrypted = self.encrypt_headers(req.headers.as_ref())?;
        // Secret rotation is intentionally not exposed via patch: the rotated
        // secret can only be revealed once, and patch returns the (secret-free)
        // webhook. Rotation is deferred to a dedicated endpoint that can return
        // the new secret (the repository/`WebhookFieldsPatch` already support
        // setting `secret_encrypted` for when that lands).

        let has_field_change = patch.name.is_some()
            || patch.endpoint_url.is_some()
            || patch.status.is_some()
            || patch.headers_encrypted.is_some();

        let mut updated = if has_field_change {
            self.repository
                .update_webhook(webhook_id, patch)
                .await
                .map_err(repo_to_patch_error)?
        } else {
            existing
        };

        if let Some(definition) = new_rule_def {
            let record = NewRuleRecord {
                // Reuse the existing rule id so the one-rule-per-webhook row is
                // updated in place; mint a new id only if somehow none existed.
                id: existing_rule_id.unwrap_or_else(WebhookRuleId::generate),
                workspace_id: actor.workspace_id.clone(),
                name: req.rule.as_ref().and_then(|input| input.name.clone()),
                enabled: req
                    .rule
                    .as_ref()
                    .and_then(|input| input.enabled)
                    .unwrap_or(true),
                definition,
            };
            updated = self
                .repository
                .replace_rule(webhook_id, record)
                .await
                .map_err(repo_to_patch_error)?;
        }

        Ok(updated)
    }
}

/// Map a repository error encountered while updating to the patch error,
/// preserving the not-found distinction (e.g. a concurrent delete).
fn repo_to_patch_error(error: WebhookRepoError) -> PatchWebhookError {
    match error {
        WebhookRepoError::NotFound => PatchWebhookError::NotFound,
        other => PatchWebhookError::Storage(other),
    }
}

/// Internal error for the header validation/encryption helper, lifted into the
/// public create/patch errors.
#[derive(Debug, thiserror::Error)]
enum HeaderError {
    #[error("header '{0}' is reserved and cannot be set")]
    Reserved(String),
    #[error(transparent)]
    Encryption(#[from] EncryptionError),
    #[error("failed to serialize headers: {0}")]
    Serialize(#[source] serde_json::Error),
}

/// Errors returned by [`WebhookService::validate_webhook`].
#[derive(Debug, thiserror::Error)]
pub enum ValidateWebhookError {
    /// The endpoint URL is not acceptable.
    #[error("invalid endpoint: {0}")]
    InvalidEndpoint(#[from] EndpointValidationError),
    /// The rule's structure is invalid.
    #[error("invalid rule: {0}")]
    InvalidRule(#[from] RuleValidationError),
    /// The caller lacks access to a resource the rule filters on.
    #[error("you do not have access to {entity} '{id}' referenced by filter field '{field}'")]
    ResourceForbidden {
        /// The resource's entity type (e.g. `channel`).
        entity: String,
        /// The resource id.
        id: String,
        /// The filter field that referenced it.
        field: String,
    },
    /// A resource access check failed for an internal reason.
    #[error("could not verify resource access: {0}")]
    AccessCheck(#[source] AccessError),
}

/// Errors returned by [`WebhookService::create_webhook`].
#[derive(Debug, thiserror::Error)]
pub enum CreateWebhookError {
    /// The webhook draft failed validation.
    #[error(transparent)]
    Validation(#[from] ValidateWebhookError),
    /// The request was malformed (e.g. empty name, reserved header).
    #[error("invalid request: {0}")]
    BadRequest(String),
    /// A storage-layer failure.
    #[error("storage error: {0}")]
    Storage(#[from] WebhookRepoError),
    /// A secret encryption failure.
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
    /// Any other internal failure.
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl From<HeaderError> for CreateWebhookError {
    fn from(error: HeaderError) -> Self {
        match error {
            HeaderError::Reserved(name) => CreateWebhookError::BadRequest(format!(
                "header '{name}' is reserved and cannot be set"
            )),
            HeaderError::Encryption(e) => CreateWebhookError::Encryption(e),
            HeaderError::Serialize(e) => CreateWebhookError::Internal(e.into()),
        }
    }
}

/// Errors returned by [`WebhookService::patch_webhook`].
#[derive(Debug, thiserror::Error)]
pub enum PatchWebhookError {
    /// The webhook does not exist (or is not visible to the caller).
    #[error("webhook not found")]
    NotFound,
    /// The updated configuration failed validation.
    #[error(transparent)]
    Validation(#[from] ValidateWebhookError),
    /// The request was malformed.
    #[error("invalid request: {0}")]
    BadRequest(String),
    /// A storage-layer failure.
    #[error("storage error: {0}")]
    Storage(#[from] WebhookRepoError),
    /// A secret encryption failure.
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
    /// Any other internal failure.
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl From<HeaderError> for PatchWebhookError {
    fn from(error: HeaderError) -> Self {
        match error {
            HeaderError::Reserved(name) => PatchWebhookError::BadRequest(format!(
                "header '{name}' is reserved and cannot be set"
            )),
            HeaderError::Encryption(e) => PatchWebhookError::Encryption(e),
            HeaderError::Serialize(e) => PatchWebhookError::Internal(e.into()),
        }
    }
}
