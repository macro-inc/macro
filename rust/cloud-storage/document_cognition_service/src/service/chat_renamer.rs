use crate::api::context::ApiContext;
use agent::AgentModel;
use chat::domain::models::PatchChatArgs;
use chat::domain::ports::ChatRepo;
use chat::outbound::postgres::PgChatRepo;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use std::sync::Arc;

const CHAT_RENAMED_MESSAGE_TYPE: &str = "chat_renamed";
const MAX_CHAT_NAME_CHARS: usize = 100;

pub fn spawn_initial_chat_rename(
    ctx: Arc<ApiContext>,
    user_id: MacroUserIdStr<'static>,
    chat_id: String,
    stream_id: String,
    initial_question: String,
) {
    tokio::spawn(async move {
        if let Err(err) =
            rename_initial_chat(ctx, user_id, chat_id, stream_id, initial_question).await
        {
            tracing::warn!(error=?err, "failed to auto-rename initial chat");
        }
    });
}

#[tracing::instrument(skip(ctx, initial_question), err)]
async fn rename_initial_chat(
    ctx: Arc<ApiContext>,
    user_id: MacroUserIdStr<'static>,
    chat_id: String,
    stream_id: String,
    initial_question: String,
) -> anyhow::Result<()> {
    let name = generate_chat_name(&initial_question).await?;
    if name.is_empty() {
        anyhow::bail!("generated chat name was empty");
    }
    let user_id_string = user_id.as_ref().to_string();

    PgChatRepo::new(ctx.db.clone())
        .patch(
            user_id,
            &chat_id,
            PatchChatArgs {
                name: Some(name.clone()),
                project_id: None,
                share_permission: None,
            },
        )
        .await
        .map_err(anyhow::Error::from)?;

    ctx.connection_gateway_client
        .batch_send_to_entities(
            CHAT_RENAMED_MESSAGE_TYPE,
            &serde_json::json!({
                "type": CHAT_RENAMED_MESSAGE_TYPE,
                "stream_id": stream_id,
                "chat_id": chat_id,
                "name": name,
            }),
            vec![EntityType::User.with_entity_str(&user_id_string)],
        )
        .await
        .map_err(|err| anyhow::anyhow!("{err}"))?;

    Ok(())
}

async fn generate_chat_name(initial_question: &str) -> anyhow::Result<String> {
    let response = agent::complete(
        AgentModel::Fast,
        "You rename AI chats. Return only a concise title, no quotes, no punctuation-only text. Use 2-6 words.",
        initial_question,
    )
    .await?;

    Ok(clean_chat_name(&response))
}

fn clean_chat_name(raw: &str) -> String {
    let trimmed = raw
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .replace(['\n', '\r', '\t'], " ");
    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(MAX_CHAT_NAME_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::clean_chat_name;

    #[test]
    fn clean_chat_name_trims_quotes_and_collapses_whitespace() {
        assert_eq!(
            clean_chat_name("  \"Plan   Q3\nHiring\"  "),
            "Plan Q3 Hiring"
        );
    }

    #[test]
    fn clean_chat_name_limits_length() {
        let raw = "a".repeat(120);
        assert_eq!(clean_chat_name(&raw).len(), 100);
    }
}
