use crate::domain::models::model_access::{FREE_MODEL, PAID_DEFAULT_MODEL};
use crate::domain::ports::ModelAccessService;

/// Default [`ModelAccessService`]: free users get only [`FREE_MODEL`],
/// professional users get every model in [`CHAT_MODELS`].
#[derive(Debug, Default, Clone, Copy)]
pub struct ModelAccessServiceImpl;

impl ModelAccessService for ModelAccessServiceImpl {
    fn best_model(&self, professional: bool) -> &'static str {
        if professional {
            PAID_DEFAULT_MODEL
        } else {
            FREE_MODEL
        }
    }

    fn has_access(&self, professional: bool, model_id: &str) -> bool {
        professional || model_id == FREE_MODEL
    }
}

#[cfg(test)]
mod test;
