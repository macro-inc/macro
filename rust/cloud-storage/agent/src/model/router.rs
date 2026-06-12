//! Frontend-authoritative model routing.
//!
//! Per-provider id validation lives with each model type
//! ([`AnthropicModelId`], [`OpenAiModelId`]): their `TryFrom<String>` is the
//! only constructor and checks the id against that provider's namespace. The
//! single-provider [`AnthropicRouter`] / [`OpenAiRouter`] just bind a validated
//! id to a client. This module owns the cross-provider pieces: the
//! [`RoutedModel`] dispatch enum and the [`AllModelsRouter`] that composes the
//! per-provider routers and fans any raw id out to the one serving it.

mod anthropic;
mod openai;

#[cfg(test)]
mod test;

use self::anthropic::AnthropicRouter;
use self::openai::OpenAiRouter;
use super::anthropic::{AnthropicModel, AnthropicModelId};
use super::openai::{OpenAiModel, OpenAiModelId};
use super::types::ModelRouter;
use crate::error::AgentError;
use rig_core::providers::anthropic::Client as AnthropicClient;
use rig_core::providers::openai::Client as OpenAiClient;
use std::sync::Arc;

/// A routed model, tagged by the provider that serves it.
///
/// The two providers' completion models are distinct concrete types, so they
/// can't be unified behind a single `impl Model` (`Model::completion` would
/// have to return two types). The caller matches on the variant to build the
/// provider-specific agent — mirroring the `ProviderAgent` split in
/// `agent_loop`.
pub enum RoutedModel {
    /// An Anthropic (Claude) model.
    Anthropic(AnthropicModel),
    /// An OpenAI model.
    OpenAi(OpenAiModel),
}

/// Routes any supported model id to the provider that serves it.
///
/// Composes one single-provider router per provider. Both provider clients are
/// required at construction, so routing only fails for unknown ids.
pub struct AllModelsRouter {
    anthropic: AnthropicRouter,
    openai: OpenAiRouter,
}

impl AllModelsRouter {
    /// Build a router over the given provider clients.
    pub fn new(anthropic_client: Arc<AnthropicClient>, openai_client: Arc<OpenAiClient>) -> Self {
        Self {
            anthropic: AnthropicRouter::new(anthropic_client),
            openai: OpenAiRouter::new(openai_client),
        }
    }

    /// Route `model` to a provider-tagged [`RoutedModel`].
    ///
    /// Dispatch is driven by which provider's id type accepts the string:
    /// unknown ids match neither and yield [`AgentError::UnknownModel`].
    pub fn route(&self, model: &str) -> crate::error::Result<RoutedModel> {
        if let Ok(id) = OpenAiModelId::try_from(model.to_string()) {
            Ok(RoutedModel::OpenAi(self.openai.route_model(id)))
        } else if let Ok(id) = AnthropicModelId::try_from(model.to_string()) {
            Ok(RoutedModel::Anthropic(self.anthropic.route_model(id)))
        } else {
            Err(AgentError::UnknownModel(model.to_string()))
        }
    }

    /// Route `model`, falling back to the default model on any failure
    /// (unknown id). The default is always served by the Anthropic router,
    /// which is required, so this never fails.
    pub fn route_or_default(&self, model: &str) -> RoutedModel {
        self.route(model).unwrap_or_else(|_| {
            let default = AnthropicModelId::try_from(super::AgentModel::default().to_string())
                .expect("default model is a valid Anthropic id");
            RoutedModel::Anthropic(self.anthropic.route_model(default))
        })
    }
}
