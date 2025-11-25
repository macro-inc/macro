use utoipa::ToSchema;

/// The search service version of a highlight
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct Highlight {
    /// If the match was on the entity name, this will be present with that highlight
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// If the match was on the entity content, this will provide a list of highlights
    /// for each content match
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, ToSchema)]
pub struct SearchGotoDocument {
    /// The node id of the document
    /// This can be a stringified page number 0-indexed for pdf/docx files,
    /// or it can be a unique id that is used in lexical for markdown files.
    pub node_id: String,
    /// The raw content of the document
    pub raw_content: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, ToSchema)]
pub struct SearchGotoChat {
    /// The chat message id
    pub chat_message_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, ToSchema)]
pub struct SearchGotoEmail {
    /// The email message id
    pub email_message_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, ToSchema)]
pub struct SearchGotoChannel {
    /// The channel message id
    pub channel_message_id: String,
}

/// The search service version of a goto
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(untagged)]
pub enum SearchGotoContent {
    Documents(SearchGotoDocument),
    Chats(SearchGotoChat),
    Emails(SearchGotoEmail),
    Channels(SearchGotoChannel),
}

impl From<opensearch_client::search::model::SearchGotoContent> for SearchGotoContent {
    fn from(goto: opensearch_client::search::model::SearchGotoContent) -> Self {
        match goto {
            opensearch_client::search::model::SearchGotoContent::Documents(a) => {
                SearchGotoContent::Documents(SearchGotoDocument {
                    node_id: a.node_id,
                    raw_content: a.raw_content,
                })
            }
            opensearch_client::search::model::SearchGotoContent::Chats(a) => {
                SearchGotoContent::Chats(SearchGotoChat {
                    chat_message_id: a.chat_message_id,
                })
            }
            opensearch_client::search::model::SearchGotoContent::Emails(a) => {
                SearchGotoContent::Emails(SearchGotoEmail {
                    email_message_id: a.email_message_id,
                })
            }
            opensearch_client::search::model::SearchGotoContent::Channels(a) => {
                SearchGotoContent::Channels(SearchGotoChannel {
                    channel_message_id: a.channel_message_id,
                })
            }
        }
    }
}

/// Simple response item to mimic what we get back from opensearch
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SimpleSearchResponseItem {
    pub entity_id: String,
    pub entity_type: String,
    pub score: Option<f64>,
    pub highlight: Highlight,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goto: Option<SearchGotoContent>,
}

/// The response for simple search
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SimpleSearchResponse {
    pub results: Vec<SimpleSearchResponseItem>,
}

impl From<opensearch_client::search::model::SearchHit> for SimpleSearchResponseItem {
    fn from(hit: opensearch_client::search::model::SearchHit) -> Self {
        Self {
            entity_id: hit.entity_id,
            entity_type: hit.entity_type.to_string(),
            score: hit.score,
            highlight: Highlight {
                name: hit.highlight.name,
                content: hit.highlight.content,
            },
            goto: hit.goto.map(|a| a.into()),
        }
    }
}
