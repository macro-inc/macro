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
