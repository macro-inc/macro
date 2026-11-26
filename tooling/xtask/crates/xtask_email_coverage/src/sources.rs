//! `crates/email_e2e/coverage/sources.toml`: where the generator looks for
//! entry points, and the few facts it cannot read from the code.

use std::path::Path;

use rootcause::prelude::*;
use serde::Deserialize;

use crate::row::{Kind, Providers};

/// Repository-relative path of the hand-maintained configuration.
pub const SOURCES_PATH: &str = "crates/email_e2e/coverage/sources.toml";

/// An item of a source file, written `path/to/file.rs::Ident`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub struct ItemRef {
    /// Repository-relative path of the file.
    pub file: String,
    /// Name of the function or type in that file.
    pub ident: String,
}

impl TryFrom<String> for ItemRef {
    type Error = String;

    fn try_from(written: String) -> Result<Self, Self::Error> {
        match written.rsplit_once("::") {
            Some((file, ident)) if !file.is_empty() && !ident.is_empty() => Ok(Self {
                file: file.to_owned(),
                ident: ident.to_owned(),
            }),
            _ => Err(format!("`{written}` is not `path/to/file.rs::Ident`")),
        }
    }
}

/// The whole configuration file.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sources {
    /// The email service's HTTP API.
    pub http: HttpSource,
    /// Provider webhook handlers.
    #[serde(default)]
    pub webhook: Vec<WebhookSource>,
    /// GraphQL resolvers.
    pub graphql: GraphqlSource,
    /// GraphQL types the generator cannot work out by itself.
    #[serde(default)]
    pub graphql_type: Vec<GraphqlTypeMapping>,
    /// The binary that starts the queue workers.
    pub queue_workers: QueueWorkers,
    /// Queues the email workers consume.
    #[serde(default)]
    pub queue: Vec<QueueSource>,
    /// Kafka topics the email services publish to.
    #[serde(default)]
    pub kafka: Vec<KafkaSource>,
    /// Connection gateway pushes.
    #[serde(default)]
    pub gateway: Vec<GatewaySource>,
    /// Agent toolsets.
    #[serde(default)]
    pub tool: Vec<ToolSource>,
    /// Lambda service directories.
    #[serde(default)]
    pub lambda: Vec<LambdaSource>,
    /// Provider API route enums.
    #[serde(default)]
    pub provider: Vec<ProviderSource>,
    /// Files holding background loops.
    #[serde(default, rename = "loop")]
    pub loops: Vec<LoopSource>,
    /// Routes of other services that carry email functions out.
    #[serde(default)]
    pub elsewhere: Vec<ElsewhereSource>,
    /// Rows whose providers differ from the default rule.
    #[serde(default)]
    pub applies: Vec<ProvidersOverride>,
}

impl Sources {
    /// Reads the configuration of the repository at `repo_root`.
    pub fn load(repo_root: &Path) -> Result<Self, Report> {
        let text = std::fs::read_to_string(repo_root.join(SOURCES_PATH))
            .context(format!("could not read {SOURCES_PATH}"))?;
        Ok(toml::from_str(&text).context(format!("{SOURCES_PATH} is not valid"))?)
    }
}

/// `[http]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HttpSource {
    /// The function that builds the whole served router.
    pub root: ItemRef,
    /// Functions whose routers are left out.
    #[serde(default)]
    pub skip: Vec<String>,
    /// Functions that mount the router they are given a second time under a
    /// prefix; only the router itself is listed.
    #[serde(default)]
    pub mounted_again: Vec<String>,
}

/// `[[webhook]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebhookSource {
    /// First part of every key, the provider's name.
    pub prefix: String,
    /// The webhook's handler function.
    pub handler: ItemRef,
    /// The query field whose presence marks a validation handshake.
    pub validation_field: String,
    /// The notification field the handler matches on to tell lifecycle
    /// events from ordinary changes.
    pub lifecycle_field: String,
}

/// `[graphql]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphqlSource {
    /// Repository-relative path of the exported SDL.
    pub schema: String,
    /// Crates whose resolvers are listed.
    pub crates: Vec<GraphqlCrate>,
}

/// One entry of `[graphql] crates`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphqlCrate {
    /// Repository-relative crate directory.
    pub dir: String,
    /// When set, only resolvers whose name or whose impl type's name contains
    /// this text, ignoring case, are listed.
    pub only: Option<String>,
}

/// `[[graphql_type]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphqlTypeMapping {
    /// Name of the Rust type the resolvers are implemented on.
    pub rust: String,
    /// Name of the SDL type that carries their fields.
    pub graphql: String,
}

/// `[queue_workers]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueWorkers {
    /// The file that starts an `SQSWorker` per consumed queue.
    pub file: String,
}

/// `[[queue]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueSource {
    /// The harness's name for the queue.
    pub name: String,
    /// Harness names of queues that carry the same messages, such as a
    /// retry queue.
    #[serde(default)]
    pub aliases: Vec<String>,
    /// The `macro_queues` types the worker binary consumes for this entry;
    /// empty when another binary consumes the queue.
    #[serde(default)]
    pub consumes: Vec<String>,
    /// The enum whose variants are the message types, or the message struct.
    #[serde(rename = "type")]
    pub message: ItemRef,
    /// The struct that wraps the enum on the wire; the enum's JSON pointer
    /// is taken from the field that holds it.
    pub envelope: Option<ItemRef>,
    /// The enum's JSON pointer in the message body when there is no
    /// envelope type; empty for the body itself.
    pub at: Option<String>,
}

/// `[[kafka]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KafkaSource {
    /// The topic's name.
    pub topic: String,
    /// The enum of events published to it.
    #[serde(rename = "type")]
    pub message: ItemRef,
}

/// `[[gateway]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GatewaySource {
    /// The gateway message type, first part of every key.
    pub name: String,
    /// The enum of events pushed under that message type.
    #[serde(rename = "type")]
    pub message: ItemRef,
}

/// `[[tool]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolSource {
    /// The file that registers tools with `add_tool` and `add_user_tool`.
    pub file: String,
}

/// `[[lambda]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LambdaSource {
    /// Repository-relative glob of lambda service directories.
    pub glob: String,
}

/// `[[provider]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderSource {
    /// First part of every key, the provider's name.
    pub prefix: String,
    /// The emulator's enum of provider API methods.
    #[serde(rename = "type")]
    pub routes: ItemRef,
}

/// `[[loop]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoopSource {
    /// A file whose `pub` and `pub(crate)` `run*` functions are loops.
    pub file: String,
}

/// `[[elsewhere]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ElsewhereSource {
    /// The service, as the harness names it: `document_storage_service`.
    pub service: String,
    /// The file the routes are defined in.
    pub file: String,
    /// The routes, each `METHOD /path/{param}`.
    pub routes: Vec<String>,
}

/// `[[applies]]`
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProvidersOverride {
    /// Kind of the rows.
    pub kind: Kind,
    /// Key of the row, or a prefix ending in `*` for every key starting so.
    pub key: String,
    /// The providers those rows apply to.
    pub providers: Providers,
    /// Why the default rule is wrong for them.
    pub reason: String,
}
