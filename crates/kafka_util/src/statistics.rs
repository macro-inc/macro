//! Opt-in statistics delivery without changing assignment or commit behavior.

use std::sync::Arc;

use opentelemetry::{KeyValue, metrics::Counter};
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

/// Counter of partition positions librdkafka reset by `auto.offset.reset`
/// after an error, tagged `topic`. Usually the position was out of range and
/// the records between it and the new one were skipped; a truncated log or a
/// failing offset query also resets.
const OFFSET_RESETS: &str = "kafka.consumer.offset_resets";
/// librdkafka logs a reset after an error, and no other warning, under this
/// facility; it reports no error to the application.
const OFFSET_FACILITY: &str = "OFFSET";

pub(crate) struct StatisticsContext<C> {
    pub(crate) inner: C,
    pub(crate) observer: Option<ConsumerStatistics>,
    pub(crate) offset_resets: Counter<u64>,
}

/// [`OFFSET_RESETS`] on the global meter provider. Build it after the
/// process installs its provider, as consumers are.
pub(crate) fn offset_resets_counter() -> Counter<u64> {
    opentelemetry::global::meter("kafka_util")
        .u64_counter(OFFSET_RESETS)
        .with_description("Consumer partition positions reset after an error, such as out of range")
        .build()
}

/// The topic of a librdkafka offset reset warning:
/// `[thrd:<thread>]: <topic> [<partition>]: offset reset ...`.
fn reset_topic(message: &str) -> Option<&str> {
    use nom::{
        Parser as _,
        bytes::complete::{tag, take_until},
        character::complete::digit1,
        combinator::opt,
        sequence::{preceded, terminated},
    };

    preceded(
        opt((tag("[thrd:"), take_until("]: "), tag("]: "))),
        terminated(
            take_until::<_, _, nom::error::Error<&str>>(" ["),
            (tag(" ["), digit1, tag("]: offset reset")),
        ),
    )
    .parse(message)
    .ok()
    .map(|(_, topic)| topic)
}

impl<C: ClientContext> ClientContext for StatisticsContext<C> {
    const ENABLE_REFRESH_OAUTH_TOKEN: bool = C::ENABLE_REFRESH_OAUTH_TOKEN;

    fn log(&self, level: RDKafkaLogLevel, facility: &str, message: &str) {
        let warning_or_worse = matches!(
            level,
            RDKafkaLogLevel::Emerg
                | RDKafkaLogLevel::Alert
                | RDKafkaLogLevel::Critical
                | RDKafkaLogLevel::Error
                | RDKafkaLogLevel::Warning
        );
        if warning_or_worse && facility == OFFSET_FACILITY {
            let tags: Vec<_> = reset_topic(message)
                .map(|topic| KeyValue::new("topic", topic.to_owned()))
                .into_iter()
                .collect();
            self.offset_resets.add(1, &tags);
        }
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
