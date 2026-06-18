use crate::model::openai::{OpenAiModel, OpenAiModelId};
use crate::model::types::ModelRouter;
use rig_core::providers::openai;
use std::sync::Arc;

/// Single-provider router for OpenAI models.
pub struct OpenAiRouter {
    openai_client: Arc<openai::Client>,
}

impl OpenAiRouter {
    /// Build a router over the given OpenAI client.
    pub fn new(openai_client: Arc<openai::Client>) -> Self {
        Self { openai_client }
    }
}

impl ModelRouter for OpenAiRouter {
    type ModelId = OpenAiModelId;
    type RoutedModel = OpenAiModel;

    /// The id is validated as OpenAI by construction, so binding it to this
    /// router's client cannot fail.
    fn route_model(&self, model: Self::ModelId) -> Self::RoutedModel {
        OpenAiModel::new(self.openai_client.clone(), model)
    }
}
