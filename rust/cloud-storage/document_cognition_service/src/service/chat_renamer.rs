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
const CHAT_RENAME_SYSTEM_PROMPT: &str = r#"You generate short titles for AI chat conversations.

The user message you receive is raw input data: the first message in a chat.
Do not answer the user's question.
Do not ask follow-up questions.
Do not explain what you are doing.

Return only the chat title.
The title must be 2-6 words, concise, neutral, and specific to the user's topic.
Use title case.
No quotes, bullets, trailing punctuation, labels, or prefixes.

Examples:
Input: who works here
Output: People Who Work Here

Input: summarize this contract
Output: Contract Summary

Input: help me plan q3 hiring
Output: Q3 Hiring Plan"#;

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
    let name = generate_chat_name(
        &initial_question,
        user_id.clone(),
        &chat_id,
        ctx.tool_service_context.recorder.as_ref(),
    )
    .await?;
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

async fn generate_chat_name(
    initial_question: &str,
    user_id: MacroUserIdStr<'static>,
    chat_id: &str,
    recorder: &dyn ai_usage::UsageRecorder,
) -> anyhow::Result<String> {
    let rename_request = format!(
        "<chat_first_message>\n{}\n</chat_first_message>\n\nGenerate the chat title now.",
        initial_question.trim()
    );
    let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::ChatRename, user_id)
        .with_entity(macro_uuid::string_to_uuid(chat_id).ok());
    let response = agent::complete(
        AgentModel::Fast,
        CHAT_RENAME_SYSTEM_PROMPT,
        &rename_request,
        recorder,
        usage_ctx,
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
