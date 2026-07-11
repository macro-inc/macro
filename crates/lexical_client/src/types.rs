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
