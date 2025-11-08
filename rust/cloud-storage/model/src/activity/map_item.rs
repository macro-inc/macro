use crate::{chat::Chat, document::BasicDocument};

#[expect(
    clippy::too_many_arguments,
    reason = "no good reason but too hard to fix right now"
)]
pub fn map_document_item(
    id: String,
    user_id: String,
    document_version_id: Option<String>,
    name: String,
    created_at: Option<chrono::DateTime<chrono::Utc>>,
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
    sha: Option<String>,
    file_type: Option<String>,
    document_family_id: Option<i64>,
    branched_from_id: Option<String>,
    branched_from_version_id: Option<i64>,
    project_id: Option<String>,
) -> anyhow::Result<BasicDocument> {
    Ok(BasicDocument {
        document_id: id,
        owner: user_id,
        document_version_id: document_version_id.unwrap().parse::<i64>().unwrap(),
        document_name: name,
        created_at,
        updated_at,
        deleted_at: None, // Don't care about the deleted_at in activity
        sha,
        file_type,
        document_family_id,
        branched_from_id,
        branched_from_version_id,
        project_id,
    })
}

pub fn map_chat_item(
    id: String,
    user_id: String,
    name: String,
    created_at: Option<chrono::DateTime<chrono::Utc>>,
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
    project_id: Option<String>,
    is_persistent: Option<bool>,
) -> Chat {
    Chat {
        id,
        user_id,
        name,
        // Don't care about the model in user history
        model: None,
        created_at,
        updated_at,
        deleted_at: None, // Don't care about the deleted_at in activity
        project_id,
        token_count: None,
        is_persistent: is_persistent.unwrap_or(false),
    }
}
