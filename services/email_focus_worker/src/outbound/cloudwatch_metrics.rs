//! The rollout's numbers as CloudWatch custom metrics, which the observability
//! host's Grafana reads for the Email Focus rollout dashboard and its alerts.
//!
//! Every metric is in [`NAMESPACE`] with one dimension, `Environment` (`dev` or
//! `prod`). A local worker only logs its numbers.

use aws_sdk_cloudwatch::{
    Client,
    types::{Dimension, MetricDatum, StandardUnit},
};
use macro_env::Environment;
use rootcause::Report;

use crate::metrics::{Batch, MetricSink, Unit, distinct_values};

#[cfg(test)]
mod test;

/// Where the worker's metrics live; the task role may write only here.
pub const NAMESPACE: &str = "Macro/EmailFocus";
/// The dimension that keeps dev's numbers apart from prod's.
const ENVIRONMENT_DIMENSION: &str = "Environment";
/// Most distinct values CloudWatch takes in one datum.
const MAX_VALUES_PER_DATUM: usize = 150;
/// Most datums one request carries (CloudWatch allows 1,000).
const MAX_DATUMS_PER_REQUEST: usize = 500;

/// Publishes to CloudWatch, or only logs on a local machine.
pub enum CloudWatchMetrics {
    Publish {
        client: Client,
        environment: &'static str,
    },
    LogOnly,
}

impl CloudWatchMetrics {
    /// The sink for `environment`: CloudWatch in dev and prod, the log locally.
    pub async fn new(environment: Environment) -> Self {
        let environment = match environment {
            Environment::Production => "prod",
            Environment::Develop => "dev",
            Environment::Local => return Self::LogOnly,
        };
        Self::Publish {
            client: Client::new(&macro_aws_config::get_macro_aws_config().await),
            environment,
        }
    }
}

impl MetricSink for CloudWatchMetrics {
    async fn publish(&self, batch: &Batch) -> Result<(), Report> {
        let Self::Publish {
            client,
            environment,
        } = self
        else {
            tracing::debug!(?batch, "focus metrics (local, not published)");
            return Ok(());
        };
        let data = datums(batch, environment);
        for chunk in data.chunks(MAX_DATUMS_PER_REQUEST) {
            client
                .put_metric_data()
                .namespace(NAMESPACE)
                .set_metric_data(Some(chunk.to_vec()))
                .send()
                .await
                .map_err(|error| rootcause::report!("put_metric_data failed: {error}"))?;
        }
        Ok(())
    }
}

fn standard_unit(unit: Unit) -> StandardUnit {
    match unit {
        Unit::Count => StandardUnit::Count,
        Unit::Seconds => StandardUnit::Seconds,
        Unit::Dollars => StandardUnit::None,
    }
}

/// One batch as CloudWatch datums: a value per count, and each sample's values
/// with how often each occurred, split to fit a datum.
pub fn datums(batch: &Batch, environment: &str) -> Vec<MetricDatum> {
    let dimension = Dimension::builder()
        .name(ENVIRONMENT_DIMENSION)
        .value(environment)
        .build();
    let datum = |metric: crate::metrics::Metric| {
        MetricDatum::builder()
            .metric_name(metric.name())
            .dimensions(dimension.clone())
            .unit(standard_unit(metric.unit()))
    };
    let sums = batch
        .sums
        .iter()
        .map(|(metric, sum)| datum(*metric).value(*sum).build());
    let samples = batch.samples.iter().flat_map(|(metric, values)| {
        distinct_values(values)
            .chunks(MAX_VALUES_PER_DATUM)
            .map(|chunk| {
                let (values, counts) = chunk.iter().copied().unzip();
                datum(*metric)
                    .set_values(Some(values))
                    .set_counts(Some(counts))
                    .build()
            })
            .collect::<Vec<_>>()
    });
    sums.chain(samples).collect()
}
