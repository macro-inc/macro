//! Startup configuration and shared execution/trace policy.
pub(crate) mod snapshot;
use anyhow::Result;
use nom::Parser;
use serde::{Deserialize, Deserializer, Serialize};
use std::{future::Future, str::FromStr};
use strum::{AsRefStr, EnumString, IntoStaticStr};
use tracing::Instrument;

/// Execution mode for a route group.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, EnumString, AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum RouteMode {
    /// Preserve the lexical-service response and errors.
    #[default]
    Http,
    /// Execute only the in-process implementation, with no HTTP fallback.
    InProcess,
    /// Execute both implementations and return the HTTP result.
    Shadow,
}
/// Independently deployable route groups from S3 §4.4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum RouteGroup {
    /// Document exports, search, cognition and comment marks.
    Markdown,
    /// Imports, snapshots, mentions and explicit replies.
    Snapshot,
    /// Agent and image composers.
    Composers,
    /// Email HTML rendering.
    Html,
}
/// Validated per-group modes; omitted groups always use HTTP.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RouteModes {
    markdown: RouteMode,
    snapshot: RouteMode,
    composers: RouteMode,
    html: RouteMode,
}
/// Invalid configuration; deliberately excludes untrusted configuration text.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RouteModesError {
    /// Expected a comma-separated map of group=mode assignments.
    #[error("invalid LEXICAL_ROUTE_MODES syntax")]
    Syntax,
    /// Each group may be assigned at most once.
    #[error("duplicate LEXICAL_ROUTE_MODES group")]
    DuplicateGroup,
    /// The group is outside the supported route map.
    #[error("unknown LEXICAL_ROUTE_MODES group")]
    UnknownGroup,
    /// The mode is outside the supported execution policies.
    #[error("unknown LEXICAL_ROUTE_MODES mode")]
    UnknownMode,
}
fn assignment(input: &str) -> nom::IResult<&str, (&str, &str)> {
    use nom::{bytes::complete::take_while1, character::complete::char, sequence::separated_pair};
    let identifier = |c: char| c.is_ascii_lowercase() || c == '_';
    separated_pair(take_while1(identifier), char('='), take_while1(identifier)).parse(input)
}
impl FromStr for RouteModes {
    type Err = RouteModesError;
    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        let mut modes = Self::default();
        let mut seen = std::collections::HashSet::new();
        if value.is_empty() {
            return Ok(modes);
        }
        let (_, assignments) = nom::combinator::all_consuming(nom::multi::separated_list1(
            nom::character::complete::char(','),
            assignment,
        ))
        .parse(value)
        .map_err(|_| RouteModesError::Syntax)?;
        for (group, mode) in assignments {
            let group: RouteGroup = group.parse().map_err(|_| RouteModesError::UnknownGroup)?;
            let mode = mode.parse().map_err(|_| RouteModesError::UnknownMode)?;
            if !seen.insert(group) {
                return Err(RouteModesError::DuplicateGroup);
            }
            match group {
                RouteGroup::Markdown => modes.markdown = mode,
                RouteGroup::Snapshot => modes.snapshot = mode,
                RouteGroup::Composers => modes.composers = mode,
                RouteGroup::Html => modes.html = mode,
            }
        }
        Ok(modes)
    }
}
impl<'de> Deserialize<'de> for RouteModes {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}
impl RouteModes {
    /// The selected mode for a group, including HTTP defaults.
    pub fn mode(&self, group: RouteGroup) -> RouteMode {
        match group {
            RouteGroup::Markdown => self.markdown,
            RouteGroup::Snapshot => self.snapshot,
            RouteGroup::Composers => self.composers,
            RouteGroup::Html => self.html,
        }
    }
}
/// Shared startup config loaded by each caller through MacroConfig.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct LexicalClientConfig {
    /// Required key; an empty map or explicit HTTP assignments preserves HTTP.
    pub lexical_route_modes: RouteModes,
}
/// A route adapter has not yet been ported; explicit in-process mode never falls back.
#[derive(Debug, thiserror::Error)]
#[error("lexical route {route} is not yet ported")]
pub struct NotYetPorted {
    /// Stable operation name, never document content.
    pub route: &'static str,
}
pub(crate) async fn unavailable<T>(route: &'static str) -> Result<T> {
    Err(NotYetPorted { route }.into())
}

#[derive(Clone, Copy, IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum Route {
    Search,
    Markdown,
    CommentMark,
    Cognition,
    CognitionPresigned,
    Cognitionv2,
    SnapshotMarkdown,
    Html,
    Mentions,
    ImageMarkdown,
    AgentAnnouncement,
    AgentConnectionPrompt,
    AgentChatReply,
    AgentContext,
    ExtractReply,
    SnapshotNotion,
}
impl Route {
    pub(crate) fn group(self) -> RouteGroup {
        match self {
            Self::Search => RouteGroup::Markdown,
            Self::Markdown => RouteGroup::Markdown,
            Self::CommentMark => RouteGroup::Markdown,
            Self::Cognition => RouteGroup::Markdown,
            Self::CognitionPresigned => RouteGroup::Markdown,
            Self::Cognitionv2 => RouteGroup::Markdown,
            Self::SnapshotMarkdown => RouteGroup::Snapshot,
            Self::Html => RouteGroup::Html,
            Self::Mentions => RouteGroup::Snapshot,
            Self::ImageMarkdown => RouteGroup::Composers,
            Self::AgentAnnouncement => RouteGroup::Composers,
            Self::AgentConnectionPrompt => RouteGroup::Composers,
            Self::AgentChatReply => RouteGroup::Composers,
            Self::AgentContext => RouteGroup::Composers,
            Self::ExtractReply => RouteGroup::Snapshot,
            Self::SnapshotNotion => RouteGroup::Snapshot,
        }
    }
    fn name(self) -> &'static str {
        self.into()
    }
    fn span(self) -> tracing::Span {
        macro_rules! route_span {
            ($name:literal) => {
                tracing::info_span!(
                    $name,
                    route = tracing::field::Empty,
                    mode = tracing::field::Empty,
                    document_id = tracing::field::Empty,
                    bytes_in = tracing::field::Empty,
                    bytes_out = tracing::field::Empty,
                    outcome = tracing::field::Empty,
                    error.kind = tracing::field::Empty
                )
            };
        }
        match self {
            Self::Search => route_span!("lexical.search"),
            Self::Markdown => route_span!("lexical.markdown"),
            Self::CommentMark => route_span!("lexical.comment_mark"),
            Self::Cognition => route_span!("lexical.cognition"),
            Self::CognitionPresigned => route_span!("lexical.cognition_presigned"),
            Self::Cognitionv2 => route_span!("lexical.cognitionv2"),
            Self::SnapshotMarkdown => route_span!("lexical.snapshot_markdown"),
            Self::Html => route_span!("lexical.html"),
            Self::Mentions => route_span!("lexical.mentions"),
            Self::ImageMarkdown => route_span!("lexical.image_markdown"),
            Self::AgentAnnouncement => route_span!("lexical.agent_announcement"),
            Self::AgentConnectionPrompt => route_span!("lexical.agent_connection_prompt"),
            Self::AgentChatReply => route_span!("lexical.agent_chat_reply"),
            Self::AgentContext => route_span!("lexical.agent_context"),
            Self::ExtractReply => route_span!("lexical.extract_reply"),
            Self::SnapshotNotion => route_span!("lexical.snapshot_notion"),
        }
    }
}
fn bytes<T: Serialize>(result: &Result<T>) -> Option<Vec<u8>> {
    result
        .as_ref()
        .ok()
        .and_then(|value| serde_json::to_vec(value).ok())
}

#[derive(Debug, PartialEq)]
enum Comparable {
    Value(serde_json::Value),
    Composer(Vec<String>),
}
// S3 §4.4 / §6.5 permits only generated nanoid(21) awaitId values to differ.
// Keep literal segments rather than a sentinel that could collide with content.
fn comparable<T: Serialize>(result: &Result<T>, group: RouteGroup) -> Option<Comparable> {
    let value = serde_json::to_value(result.as_ref().ok()?).ok()?;
    if group == RouteGroup::Composers
        && let serde_json::Value::String(markdown) = &value
    {
        let await_id = lazy_regex::regex!(r#""awaitId":"[A-Za-z0-9_-]{21}""#);
        return Some(Comparable::Composer(
            await_id.split(markdown).map(str::to_owned).collect(),
        ));
    }
    Some(Comparable::Value(value))
}

// OpenTelemetry has signed integer attributes; usize/Option use debug strings.
fn record_size(span: &tracing::Span, field: &'static str, size: Option<usize>) {
    if let Some(size) = size.and_then(|size| i64::try_from(size).ok()) {
        span.record(field, size);
    }
}

pub(crate) async fn dispatch<T: Serialize>(
    mode: RouteMode,
    route: Route,
    document_id: Option<&str>,
    bytes_in: usize,
    http: impl Future<Output = Result<T>>,
    in_process: impl Future<Output = Result<T>>,
) -> Result<T> {
    dispatch_with_snapshot(mode, route, document_id, bytes_in, http, in_process, None).await
}

pub(crate) async fn dispatch_with_snapshot<T: Serialize>(
    mode: RouteMode,
    route: Route,
    document_id: Option<&str>,
    bytes_in: usize,
    http: impl Future<Output = Result<T>>,
    in_process: impl Future<Output = Result<T>>,
    snapshot: Option<snapshot::SnapshotInput>,
) -> Result<T> {
    let span = route.span();
    let group = route.group();
    let route = route.name();
    span.record("route", route);
    span.record("mode", mode.as_ref());
    span.record("document_id", document_id);
    record_size(&span, "bytes_in", Some(bytes_in));
    let result = async {
        match mode {
            RouteMode::Http => http.await,
            RouteMode::InProcess => in_process.await,
            RouteMode::Shadow => {
                async {
                    let (http, in_process) = tokio::join!(http, in_process);
                    let http_bytes = bytes(&http);
                    let local_bytes = bytes(&in_process);
                    let raw_equal = http_bytes
                        .as_ref()
                        .zip(local_bytes.as_ref())
                        .is_some_and(|(a, b)| a == b);
                    tracing::Span::current().record("raw_equal", raw_equal);
                    let mut equal = comparable(&http, group)
                        .as_ref()
                        .zip(comparable(&in_process, group).as_ref())
                        .is_some_and(|(a, b)| a == b);
                    if let Some(input) = snapshot {
                        let left = serde_json::to_value(http.as_ref().ok());
                        let right = serde_json::to_value(in_process.as_ref().ok());
                        equal = match (left, right) {
                            (Ok(left), Ok(right)) if http.is_ok() && in_process.is_ok() => {
                                match crate::in_process::run(move |_| {
                                    snapshot::compatible(&input, left, right)
                                })
                                .await
                                {
                                    Ok(equal) => equal,
                                    Err(_) => {
                                        tracing::Span::current()
                                            .record("error.kind", "snapshot_comparison");
                                        false
                                    }
                                }
                            }
                            _ => false,
                        };
                        tracing::Span::current().record("structural_equal", equal);
                    }
                    tracing::Span::current().record("equal", equal);
                    record_size(
                        &tracing::Span::current(),
                        "http_bytes",
                        http_bytes.as_ref().map(Vec::len),
                    );
                    record_size(
                        &tracing::Span::current(),
                        "in_process_bytes",
                        local_bytes.as_ref().map(Vec::len),
                    );
                    tracing::Span::current()
                        .record("outcome", if equal { "equal" } else { "mismatch" });
                    if let Err(error) = &in_process {
                        tracing::Span::current().record(
                            "error.kind",
                            if error.is::<NotYetPorted>() {
                                "not_yet_ported"
                            } else {
                                "backend"
                            },
                        );
                    }
                    if !equal {
                        tracing::warn!(route, document_id, "lexical shadow mismatch");
                    }
                    http
                }
                .instrument(tracing::info_span!(
                    "lexical.shadow",
                    route,
                    document_id,
                    equal = tracing::field::Empty,
                    raw_equal = tracing::field::Empty,
                    structural_equal = tracing::field::Empty,
                    http_bytes = tracing::field::Empty,
                    in_process_bytes = tracing::field::Empty,
                    outcome = tracing::field::Empty,
                    error.kind = tracing::field::Empty
                ))
                .await
            }
        }
    }
    .instrument(span.clone())
    .await;
    record_size(&span, "bytes_out", bytes(&result).as_ref().map(Vec::len));
    span.record("outcome", if result.is_ok() { "ok" } else { "error" });
    if let Err(error) = &result {
        span.record(
            "error.kind",
            if error.is::<NotYetPorted>() {
                "not_yet_ported"
            } else {
                "backend"
            },
        );
    }
    result
}
#[cfg(test)]
mod test;
