use crate::{
    channel::ChannelSearchResult, chat::ChatMessageSearchResult, document::DocumentSearchResult,
    email::EmailSearchResult, project::ProjectSearchResult,
};

/// Trait to grab the score from an item
pub trait HasScore {
    /// Get the score for this item
    fn score(&self) -> Option<f64>;
}

impl HasScore for DocumentSearchResult {
    fn score(&self) -> Option<f64> {
        self.score
    }
}

impl HasScore for ChatMessageSearchResult {
    fn score(&self) -> Option<f64> {
        self.score
    }
}

impl HasScore for EmailSearchResult {
    fn score(&self) -> Option<f64> {
        self.score
    }
}

impl HasScore for ProjectSearchResult {
    fn score(&self) -> Option<f64> {
        self.score
    }
}

impl HasScore for ChannelSearchResult {
    fn score(&self) -> Option<f64> {
        self.score
    }
}

/// Helper function to calculate average score
pub fn calculate_average(results: &[impl HasScore]) -> f64 {
    if results.is_empty() {
        return 0.0;
    }
    let sum: f64 = results.iter().map(|r| r.score().unwrap_or(0.0)).sum();
    sum / results.len() as f64
}
