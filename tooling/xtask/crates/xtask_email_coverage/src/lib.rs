#![deny(missing_docs)]
//! Lists every backend email entry point from the source code.
//!
//! The list is the denominator of the email end-to-end coverage measurement:
//! the harness in `crates/email_e2e` records which entry points ran, and a
//! report joins the two. It is generated, so it cannot go stale:
//! [`generate`] reads the routers, resolvers, message types and tool
//! registrations themselves, guided by `sources.toml` ([`Sources`]), and
//! fails on anything it cannot resolve instead of skipping it.

mod attrs;
mod list;
mod repo;
mod report;
mod row;
mod sources;

pub use list::{generate, generate_from};
pub use report::{Options as ReportOptions, run as report};
pub use row::{Kind, Providers, Row, diff, parse_tsv, read_tsv, render_tsv};
pub use sources::{
    GatewaySource, GraphqlCrate, GraphqlSource, GraphqlTypeMapping, HttpSource, ItemRef,
    KafkaSource, LambdaSource, LoopSource, ProviderSource, ProvidersOverride, QueueSource,
    QueueWorkers, SOURCES_PATH, Sources, ToolSource, WebhookSource,
};

/// Repository-relative path of the generated, checked-in list.
pub const ENTRYPOINTS_PATH: &str = "crates/email_e2e/coverage/entrypoints.tsv";
