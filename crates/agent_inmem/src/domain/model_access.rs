//! Plan-based model access for the in-memory runtime only.

use agent_api_keys::domain::ModelProvider;
use async_trait::async_trait;
use chat::domain::models::FREE_MODEL;
use model_owner::Owner;
use roles_and_permissions::domain::{model::PermissionId, port::UserRolesAndPermissionsService};

/// The model entitlement resolved from the trusted session owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelAccess {
    /// Only the free model is available.
    Free,
    /// Every model supported by the in-memory engine is available.
    Paid,
}

impl ModelAccess {
    /// Whether the plan permits a model; runtime support is checked separately.
    pub fn allows(self, model: &str) -> bool {
        self == Self::Paid || model == FREE_MODEL
    }

    /// Replace an inaccessible persisted/default model when opening a session.
    pub fn default_model(self, configured: &str) -> &str {
        if self.allows(configured) {
            configured
        } else {
            FREE_MODEL
        }
    }

    /// The supported models this owner may select.
    pub fn models<'a>(self, supported: &[&'a str]) -> Vec<&'a str> {
        supported
            .iter()
            .copied()
            .filter(|model| self.allows(model))
            .collect()
    }
}

/// The models a session may run: its owner's plan access, unless the
/// session's agent runs on its own key, in which case it is that key's
/// provider's models. The plan limits only what Macro pays for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionModels {
    access: ModelAccess,
    agent_key: Option<ModelProvider>,
}

impl SessionModels {
    /// Models from `access`, or from the `agent_key` provider when the
    /// session's agent has a usable key.
    #[must_use]
    pub fn new(access: ModelAccess, agent_key: Option<ModelProvider>) -> Self {
        Self { access, agent_key }
    }

    /// The provider of the agent's key the session's turns run on, if any.
    #[must_use]
    pub fn agent_key(self) -> Option<ModelProvider> {
        self.agent_key
    }

    /// Whether the session may run `model`; runtime support is checked
    /// separately.
    #[must_use]
    pub fn allows(self, model: &str) -> bool {
        match self.agent_key {
            Some(provider) => ModelProvider::of_model(model) == Some(provider),
            None => self.access.allows(model),
        }
    }

    /// Keep a persisted/default model the session may run. Without a key, an
    /// inaccessible one becomes the free model; with one, the agent's model
    /// already matches the key, which only fits an agent on its provider.
    #[must_use]
    pub fn default_model(self, configured: &str) -> &str {
        match self.agent_key {
            Some(_) => configured,
            None => self.access.default_model(configured),
        }
    }

    /// The supported models the session may select.
    #[must_use]
    pub fn models<'a>(self, supported: &[&'a str]) -> Vec<&'a str> {
        supported
            .iter()
            .copied()
            .filter(|model| self.allows(model))
            .collect()
    }
}

/// Failure to resolve or enforce model access. Lookup failures fail closed.
#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum ModelAccessError {
    /// Permissions could not be resolved for a user owner.
    #[error("unable to load model permissions")]
    Unavailable,
    /// The requested model requires a paid plan.
    #[error("this model requires a paid plan")]
    Forbidden,
}

/// Resolves current access at discovery, handshake, model changes, and execution.
#[async_trait]
pub trait InMemModelAccess: Send + Sync + 'static {
    /// Resolve access for a trusted owner, never a client-provided plan.
    async fn access(&self, owner: &Owner) -> Result<ModelAccess, ModelAccessError>;
}

/// In-memory model policy backed by the owning permissions domain service.
pub struct PermissionModelAccess<P> {
    permissions: P,
}

impl<P> PermissionModelAccess<P> {
    /// Construct the policy with the permissions domain service.
    pub fn new(permissions: P) -> Self {
        Self { permissions }
    }
}

#[async_trait]
impl<P: UserRolesAndPermissionsService> InMemModelAccess for PermissionModelAccess<P> {
    async fn access(&self, owner: &Owner) -> Result<ModelAccess, ModelAccessError> {
        let user = owner.as_user().ok_or(ModelAccessError::Unavailable)?;
        let permissions = self
            .permissions
            .get_user_permissions(user)
            .await
            .map_err(|error| {
                tracing::error!(?error, "unable to load in-memory model permissions");
                ModelAccessError::Unavailable
            })?;
        Ok(
            if permissions.contains(&PermissionId::ReadProfessionalFeatures) {
                ModelAccess::Paid
            } else {
                ModelAccess::Free
            },
        )
    }
}

#[cfg(test)]
mod test;
