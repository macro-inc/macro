//! What the services need besides the providers: Postgres, Redis, SQS and
//! Kafka.

pub(crate) mod kafka;
pub(crate) mod postgres;
pub(crate) mod redis;
pub(crate) mod sqs;
