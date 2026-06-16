use agent::AgentModel;

use crate::domain::models::model_access::{CHAT_MODELS, FREE_MODEL, ModelAccess, ModelsResponse};
use crate::domain::ports::ModelAccessService;

/// Default [`ModelAccessService`]: free users get only [`FREE_MODEL`],
/// professional users get every model in [`CHAT_MODELS`].
#[derive(Debug, Default, Clone, Copy)]
pub struct ModelAccessServiceImpl;

impl ModelAccessServiceImpl {
    fn available(model: AgentModel, professional: bool) -> bool {
        professional || model.api_id() == FREE_MODEL.api_id()
    }
}

impl ModelAccessService for ModelAccessServiceImpl {
    fn list_models(&self, professional: bool) -> ModelsResponse {
        let models = CHAT_MODELS
            .iter()
            .map(|&model| ModelAccess {
                id: model.api_id().to_owned(),
                provider: model.provider().as_str().to_owned(),
                context_window: model.context_window(),
                available: Self::available(model, professional),
            })
            .collect();
        ModelsResponse { models }
    }

    fn has_access(&self, professional: bool, model_id: &str) -> bool {
        CHAT_MODELS
            .iter()
            .any(|&model| model.api_id() == model_id && Self::available(model, professional))
    }
}

#[cfg(test)]
mod test;
