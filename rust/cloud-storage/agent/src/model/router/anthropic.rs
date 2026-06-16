use crate::model::anthropic::{AnthropicModel, AnthropicModelId};
use crate::model::types::ModelRouter;
use rig_core::providers::anthropic;
use std::sync::Arc;

/// Single-provider router for Anthropic models.
pub struct AnthropicRouter {
    anthropic_client: Arc<anthropic::Client>,
}

impl AnthropicRouter {
    /// Build a router over the given Anthropic client.
    pub fn new(anthropic_client: Arc<anthropic::Client>) -> Self {
        Self { anthropic_client }
    }
}

impl ModelRouter for AnthropicRouter {
    type ModelId = AnthropicModelId;
    type RoutedModel = AnthropicModel;

    /// The id is validated as Anthropic by construction, so binding it to this
    /// router's client cannot fail.
    fn route_model(&self, model: Self::ModelId) -> Self::RoutedModel {
        AnthropicModel::new(self.anthropic_client.clone(), model)
    }
}
