use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownNode {
    pub node_id: String,
    // this is the human readable stuff
    pub content: String,
    // this is the json repr
    pub raw_content: String,
    // H1, em , code etc
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitionResponseData {
    pub data: Vec<MarkdownNode>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenericNode {
    /// Lexical node id
    pub node_id: String,
    /// Content
    pub content: String,
    /// h1, em, code, etc
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum NewMdNode {
    Generic(GenericNode),
    StaticImage { url: String },
    DssImage { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitionV2ResponseData {
    pub data: Vec<NewMdNode>,
}

/// One parsed markdown node from the lexical service's `/cognition` parse.
///
/// Lives here rather than in `models_search` so `lexical_client` stays free of
/// that crate: the chain `models_search -> models_soup -> email` would
/// otherwise make any dependency on this client circular for `email`.
#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct MarkdownParseResult {
    /// Lexical node id.
    pub node_id: String,
    /// Node content.
    pub content: String,
    /// Node content before markdown stripping.
    pub raw_content: String,
}
