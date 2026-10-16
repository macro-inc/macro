//! Opt-in statistics delivery without changing assignment or commit behavior.

use std::sync::Arc;

use rdkafka::{
    client::{ClientContext, OAuthToken},
    config::RDKafkaLogLevel,
    consumer::ConsumerContext,
    error::KafkaError,
    statistics::Statistics,
};

/// A nonblocking observer of librdkafka statistics. Called while polling the
/// consumer; observers must not perform I/O or log entire statistics payloads.
pub type ConsumerStatistics = Arc<dyn Fn(&Statistics) + Send + Sync>;

pub(crate) struct StatisticsContext<C> {
    pub(crate) inner: C,
    pub(crate) observer: Option<ConsumerStatistics>,
}

impl<C: ClientContext> ClientContext for StatisticsContext<C> {
    const ENABLE_REFRESH_OAUTH_TOKEN: bool = C::ENABLE_REFRESH_OAUTH_TOKEN;

    fn log(&self, level: RDKafkaLogLevel, facility: &str, message: &str) {
        self.inner.log(level, facility, message);
    }

    fn error(&self, error: KafkaError, reason: &str) {
        self.inner.error(error, reason);
    }

    fn stats(&self, statistics: Statistics) {
        if let Some(observer) = &self.observer {
            observer(&statistics);
        }
    }

    fn generate_oauth_token(
        &self,
        config: Option<&str>,
    ) -> Result<OAuthToken, Box<dyn std::error::Error>> {
        self.inner.generate_oauth_token(config)
    }
}

// Both supported inner contexts use the default rebalance/commit callbacks.
impl<C: ConsumerContext> ConsumerContext for StatisticsContext<C> {}

#[cfg(test)]
mod test;
