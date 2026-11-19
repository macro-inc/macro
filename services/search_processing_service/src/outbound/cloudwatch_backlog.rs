//! Each task's [`LaneBacklog`] as a CloudWatch custom metric, which the
//! service's ECS autoscaling tracks (infra/stacks/search-processing-service).
//!
//! One metric, [`OLDEST_PENDING`] in [`NAMESPACE`], with the dimensions
//! `Environment` (`dev` or `prod`) and `Lane` (`live` or `email`). Every task
//! publishes its own reading for each lane it owns partitions in, so
//! autoscaling reads the `Maximum`. A local service only logs its readings.

use std::time::Duration;

use aws_sdk_cloudwatch::{
    Client,
    error::SdkError,
    operation::put_metric_data::PutMetricDataError,
    types::{Dimension, MetricDatum, StandardUnit},
};
use macro_env::Environment;

#[cfg(test)]
mod test;

use crate::domain::backlog::{BacklogSink, LaneBacklog};

/// Where the readings live; the task role may write only here.
pub(crate) const NAMESPACE: &str = "Macro/SearchProcessing";
/// Seconds since the oldest record not yet processed on a lane was recorded.
pub(crate) const OLDEST_PENDING: &str = "OldestPendingSeconds";
const ENVIRONMENT_DIMENSION: &str = "Environment";
const LANE_DIMENSION: &str = "Lane";
/// Longest one request may take, so a slow CloudWatch never delays the next
/// round.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Publishes to CloudWatch, or only logs on a local machine.
pub(crate) enum CloudWatchBacklog {
    Publish {
        client: Client,
        environment: &'static str,
    },
    LogOnly,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PublishBacklogError {
    #[error("the CloudWatch request for the backlog readings failed")]
    Request(#[source] Box<SdkError<PutMetricDataError>>),
    #[error("CloudWatch did not answer within {0:?}")]
    TimedOut(Duration),
}

impl CloudWatchBacklog {
    /// The sink for `environment`: `client` in dev and prod, the log locally.
    pub(crate) fn new(environment: Environment, client: Client) -> Self {
        let environment = match environment {
            Environment::Production => "prod",
            Environment::Develop => "dev",
            Environment::Local => return Self::LogOnly,
        };
        Self::Publish {
            client,
            environment,
        }
    }
}

impl BacklogSink for CloudWatchBacklog {
    type Err = PublishBacklogError;

    async fn publish(&self, backlog: LaneBacklog) -> Result<(), Self::Err> {
        let Self::Publish {
            client,
            environment,
        } = self
        else {
            tracing::debug!(?backlog, "search backlog (local, not published)");
            return Ok(());
        };
        let request = client
            .put_metric_data()
            .namespace(NAMESPACE)
            .set_metric_data(Some(datums(backlog, environment)))
            .send();
        match tokio::time::timeout(REQUEST_TIMEOUT, request).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(error)) => Err(PublishBacklogError::Request(Box::new(error))),
            Err(_) => Err(PublishBacklogError::TimedOut(REQUEST_TIMEOUT)),
        }
    }
}

/// One datum per lane the task owns partitions in, in seconds.
pub(crate) fn datums(backlog: LaneBacklog, environment: &str) -> Vec<MetricDatum> {
    [("live", backlog.live), ("email", backlog.email)]
        .into_iter()
        .filter_map(|(lane, age)| Some((lane, age?)))
        .map(|(lane, age)| {
            MetricDatum::builder()
                .metric_name(OLDEST_PENDING)
                .dimensions(
                    Dimension::builder()
                        .name(ENVIRONMENT_DIMENSION)
                        .value(environment)
                        .build(),
                )
                .dimensions(
                    Dimension::builder()
                        .name(LANE_DIMENSION)
                        .value(lane)
                        .build(),
                )
                .unit(StandardUnit::Seconds)
                .value(age.as_secs_f64())
                .build()
        })
        .collect()
}
