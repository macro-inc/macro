// biohazard
use crate::api::context::ApiContext;
use crate::core::model::FALLBACK_MODEL;
use crate::model::chats::ChatResponse;
use ai::model_selection::ModelSelection;
use anyhow::Context;
use macro_db_client::dcs::get_chat::{get_chat_db, get_messages, get_web_citations};
use unfurl_service::GetUnfurlResponse;

#[tracing::instrument(err, skip(ctx))]
pub async fn get_chat(
    ctx: &ApiContext,
    chat_id: &str,
    current_user_id: &str,
) -> anyhow::Result<ChatResponse> {
    let chat = get_chat_db(&ctx.db, chat_id)
        .await
        .context("Failed to get chat from database")?;

    let messages = get_messages(&ctx.db, chat_id)
        .await
        .context("Failed to get messages")?;

    let model = Some(FALLBACK_MODEL);

    // relic of model selection
    let model_selection = ModelSelection {
        available_models: vec![FALLBACK_MODEL],
        new_model: None,
    };

    let web_citations = get_web_citations(&ctx.db, chat_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| {
            (
                k,
                v.into_iter()
                    .map(|v| GetUnfurlResponse {
                        description: v.description,
                        favicon_url: v.favicon_url,
                        image_url: v.image_url,
                        title: v.title,
                        url: v.url,
                    })
                    .collect(),
            )
        })
        .collect();

    #[allow(deprecated)]
    Ok(ChatResponse {
        id: chat.id,
        user_id: chat.user_id,
        name: chat.name,
        model,
        messages,
        project_id: chat.project_id,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
        attachments: vec![],
        token_count: chat.token_count,
        available_models: model_selection.available_models,
        web_citations,
        is_persistent: chat.is_persistent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("chat_example"))
    )]
    /// chat three has 2 messages,
    /// it has 0 active attachments
    /// but message-one has 3 message attachments
    async fn test_get_chat(pool: Pool<Postgres>) {
        let ctx = crate::api::context::test_api_context(pool.clone()).await;
        let chat = get_chat(&ctx, "chat-three", "user").await.unwrap();

        assert_eq!(chat.id, "chat-three".to_string());
        assert_eq!(chat.user_id, "macro|user@user.com".to_string());
        assert_eq!(chat.name, "test-chat 3".to_string());
        assert!(chat.model.is_some(), "some model");

        assert_eq!(chat.messages.len(), 2);
        assert_eq!(chat.messages[0].attachments.len(), 3);
    }
}
