use crate::types::{Model, ModelWithMetadataAndProvider};
use anyhow::{Context, Result};

/// 15 percent of the context window as a threshold
/// this is to account fot the difference in tokenization between different models
const THRESHOLD_PERCENTAGE: f64 = 0.15;

#[derive(Debug)]
pub struct ModelSelection {
    pub available_models: Vec<Model>,
    pub new_model: Option<Model>,
}

/// Returns the threshold for a given model
pub fn get_threshold_for_model(model: &Model) -> i64 {
    let context_window = model.metadata().context_window as f64;
    (context_window * THRESHOLD_PERCENTAGE) as i64
}

#[tracing::instrument]
pub fn select_model(
    current_model: Option<Model>,
    token_count: i64,
    models: Vec<Model>,
) -> Result<ModelSelection> {
    // Filter out models that don't have enough of a context window
    let available_models = models
        .into_iter()
        .filter(|m| {
            (m.metadata().context_window as i64 - get_threshold_for_model(m)) >= token_count
        })
        .collect::<Vec<Model>>();

    tracing::trace!("available models: {:#?}", available_models);

    // Selects a model from the available models
    // disregarding provider preference
    let select_model_without_provider = |available_models: &Vec<Model>| -> Result<Model> {
        Ok(*available_models
            .iter()
            .map(|m| (m, m.metadata().context_window as i64))
            .max_by(|a, b| a.1.cmp(&b.1))
            .iter()
            .next_back()
            .context("no available models")?
            .0)
    };

    // If the current model is not in the list of available models, find the closest model
    if available_models.iter().any(|m| Some(*m) == current_model) {
        Ok(ModelSelection {
            available_models,
            new_model: None,
        })
    } else {
        let new_model = select_model_without_provider(&available_models)?;
        tracing::info!(
            "switching model from {:?} to {}, for token count {}",
            current_model,
            new_model,
            token_count
        );

        Ok(ModelSelection {
            available_models,
            new_model: Some(new_model),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Model;
    use strum::IntoEnumIterator;
    #[test]
    #[ignore]
    fn test_model_selection() {
        // Without a current model, we should still select a model
        let without_current = select_model(None, 250000, Model::iter().collect()).unwrap();
        assert_eq!(without_current.available_models.len(), 2);
        assert!(without_current.new_model.is_some());
        assert_eq!(without_current.new_model.unwrap(), Model::Gemini20Flash);

        // current model that is available should not change the selection
        let with_current =
            select_model(Some(Model::Gemini20Flash), 250000, Model::iter().collect()).unwrap();
        assert_eq!(with_current.available_models.len(), 2);
        assert!(with_current.new_model.is_none());

        // current model that is not available should select the closest model
        let with_bad_current =
            select_model(Some(Model::Gemini20Flash), 500000, Model::iter().collect()).unwrap();
        assert_eq!(with_bad_current.available_models.len(), 2);
        assert!(with_bad_current.new_model.is_some());
        assert_eq!(with_bad_current.new_model.unwrap(), Model::Gemini20Flash);
    }

    #[test]
    fn test_model_gemini() {
        let token_count = 56292;
        let models = &[
            Model::Gemini25Pro,
            Model::Gemini15Pro,
            Model::Gemini20Flash,
            Model::OpenAiGpt41,
            Model::OpenAIo3,
            Model::Claude4Sonnet,
        ];
        let new_model = select_model(Some(Model::Gemini20Flash), token_count, models.to_vec())
            .expect("model selection");
        assert_eq!(new_model.new_model, None);

        let new_model = select_model(Some(Model::Gemini15Pro), token_count, models.to_vec())
            .expect("model selection");
        assert_eq!(new_model.new_model, None);
    }
}
