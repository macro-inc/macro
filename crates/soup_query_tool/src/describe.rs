//! `DescribeSoup`: fetch the schema slice a QuerySoup query needs.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::schema::input::SoupKind;
use crate::schema::slices::{Topic, topic_sdl};

/// A slice of the QuerySoup schema, named like the `GraphqlSoupEntityType`
/// value it describes, plus `PROPERTIES`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SoupSchemaTopic {
    /// `documentFilter` literal and `GraphqlSoupDocument` (tasks, snippets, skills).
    Document,
    /// `chatFilter` literal and `GraphqlSoupChat`.
    Chat,
    /// `projectFilter` literal and `GraphqlSoupProject`.
    Project,
    /// `emailFilter` literal and `GraphqlSoupEmailThread`.
    EmailThread,
    /// `channelFilter` literal and `GraphqlSoupChannel`.
    Channel,
    /// `channelThreadFilter` literal and `GraphqlSoupChannelMessage`.
    ChannelMessage,
    /// `callFilter` literal and `GraphqlSoupCall`.
    Call,
    /// `calendarEventFilter` literal and `GraphqlSoupCalendarEvent`.
    CalendarEvent,
    /// `foreignEntityFilter` literal and `GraphqlSoupForeignEntity`.
    ForeignEntity,
    /// `properties { … }` on every item and the `propertiesFilter` literal.
    Properties,
}

impl From<SoupSchemaTopic> for Topic {
    fn from(topic: SoupSchemaTopic) -> Self {
        match topic {
            SoupSchemaTopic::Document => Topic::Kind(SoupKind::Document),
            SoupSchemaTopic::Chat => Topic::Kind(SoupKind::Chat),
            SoupSchemaTopic::Project => Topic::Kind(SoupKind::Project),
            SoupSchemaTopic::EmailThread => Topic::Kind(SoupKind::EmailThread),
            SoupSchemaTopic::Channel => Topic::Kind(SoupKind::Channel),
            SoupSchemaTopic::ChannelMessage => Topic::Kind(SoupKind::ChannelMessage),
            SoupSchemaTopic::Call => Topic::Kind(SoupKind::Call),
            SoupSchemaTopic::CalendarEvent => Topic::Kind(SoupKind::CalendarEvent),
            SoupSchemaTopic::ForeignEntity => Topic::Kind(SoupKind::ForeignEntity),
            SoupSchemaTopic::Properties => Topic::Properties,
        }
    }
}

/// Return the GraphQL SDL for parts of the QuerySoup schema that its
/// description leaves out.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DescribeSoup",
    description = "Return the QuerySoup schema for one or more topics: a kind's filter literal (what goes inside `filters.<kind>Filter: { literal: … }`) and its output type (what you can select under `... on GraphqlSoup<Kind>`), or PROPERTIES for `properties { … }` and `propertiesFilter`. QuerySoup's own description only carries the shared types, so call this before writing a query that filters on or selects fields of a kind you have not seen the schema for in this conversation. Cheap and read-only; ask for every topic you need in one call."
)]
pub struct DescribeSoup {
    /// Topics to describe. At least one.
    #[schemars(
        description = "Topics to describe, e.g. [\"DOCUMENT\", \"EMAIL_THREAD\"] or [\"PROPERTIES\"]."
    )]
    pub topics: Vec<SoupSchemaTopic>,
}

/// SDL for the requested topics, in the order asked.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DescribeSoupResponse {
    /// GraphQL SDL. Types already on QuerySoup's card are not repeated.
    pub sdl: String,
}

impl ToolAnnotated for DescribeSoup {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Describe workspace schema");
}

#[async_trait]
impl<C: Send + Sync + 'static> AsyncTool<C> for DescribeSoup {
    type Output = DescribeSoupResponse;

    #[tracing::instrument(skip_all, fields(topics = ?self.topics), err)]
    async fn call(
        &self,
        _service_context: ServiceContext<C>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.topics.is_empty() {
            return Err(ai_toolset::ToolCallError {
                description: "Pass at least one topic, e.g. [\"DOCUMENT\"].".to_owned(),
                internal_error: anyhow::anyhow!("DescribeSoup called with no topics"),
            });
        }
        let mut seen = std::collections::HashSet::new();
        let sdl = self
            .topics
            .iter()
            .copied()
            .filter(|topic| seen.insert(*topic))
            .map(|topic| topic_sdl(topic.into()))
            .collect::<Vec<_>>()
            .join("\n\n");
        Ok(DescribeSoupResponse { sdl })
    }
}
