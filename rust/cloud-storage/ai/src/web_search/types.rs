use serde::{Deserialize, Serialize};
// https://docs.perplexity.ai/api-reference/chat-completions-post

#[derive(Serialize, Deserialize, Debug, Copy, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    System,
    Assistant,
}

pub const SEARCH_MODEL: &str = "sonar";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct RequestBody {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_domain_filter: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_recency_filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

impl RequestBody {
    pub fn default_query(query: String, system_prompt: String) -> Self {
        let messages = vec![
            Message {
                role: Role::System,
                content: system_prompt,
            },
            Message {
                role: Role::User,
                content: query,
            },
        ];
        Self {
            model: SEARCH_MODEL.to_string(),
            messages,
            ..Default::default()
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Usage {
    pub prompt_tokens: f64,
    pub completion_tokens: f64,
    pub total_tokens: f64, // there's some other shit in here that you can define if you need (all optional)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Choice {
    pub index: i64,
    pub message: Message,
    // this is an enum
    pub finish_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Response {
    pub id: String,
    pub model: String,
    pub created: i64,
    pub usage: Usage,
    pub object: String,
    pub choices: Vec<Choice>,
    pub search_results: Vec<SearchResult>,
}
