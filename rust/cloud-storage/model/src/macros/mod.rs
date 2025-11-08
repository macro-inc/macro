use chrono::serde::ts_seconds_option;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(sqlx::FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Macro {
    /// The macro uuid
    pub id: String,
    /// Who the macro belongs to
    pub user_id: String,
    /// The title of the macro prompt
    pub title: String,
    /// The prompt used in the macro
    pub prompt: String,
    /// The icon of the macro
    pub icon: String,
    /// The color of the macro
    pub color: String,
    /// The required number of documents to use the macro
    pub required_docs: Option<i32>,
    /// The time the macro was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the macro was last updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

// TODO: support macro attachments
// for now this is the same as a Macro. When we add attachments this will differ.
#[derive(sqlx::FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MacroResponse {
    /// The macro uuid
    pub id: String,
    /// The title of the macro prompt
    pub title: String,
    /// Who the macro belongs to
    pub user_id: String,
    /// The prompt used in the macro
    pub prompt: String,
    /// The icon of the macro
    pub icon: String,
    /// The color of the macro
    pub color: String,
    /// The required number of documents to use the macro
    pub required_docs: Option<i32>,
    /// The time the macro was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the macro was last updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<Macro> for MacroResponse {
    fn from(m: Macro) -> Self {
        MacroResponse {
            id: m.id,
            user_id: m.user_id,
            title: m.title,
            prompt: m.prompt,
            icon: m.icon,
            color: m.color,
            required_docs: m.required_docs,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase", transparent)]
pub struct MacrosResponse {
    pub macros: Vec<Macro>,
}
