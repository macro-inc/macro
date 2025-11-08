use ai::types::Model;
use std::time::Duration;
use strum::{Display, EnumString};

#[derive(Debug, Clone, Copy, Display, EnumString)]
#[strum(serialize_all = "SCREAMING-KEBAB-CASE")]
pub enum LatencyMetric {
    TimeToSendRequest,
    TimeToFirstToken,
}

pub fn log_timing(metric: LatencyMetric, model: Model, duration: Duration) {
    tracing::info!(
        metric = %metric,
        model_name = %model,
        duration_ms = duration.as_millis(),
    );
}
