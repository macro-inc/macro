use super::types::AIDiffResponse;
use super::types::{PROMPT, REWRITE_MODEL};
use crate::tool_context::ToolScribe;
use ai::types::{MessageBuilder, RequestBuilder};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use anyhow::Error;
use async_trait::async_trait;
use model::document::FileType;
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize, JsonSchema, Debug, Clone)]
#[schemars(
    description = "Instruct an agent to edit a markdown file identified by an id.
    This tool should be used when the user include a markdown file in context and requests a revision or edit to that file"
)]
pub struct MarkdownRewrite {
    #[schemars(
        description = "The markdown file id to target for editing. This file id will be in your context and labeled as a markdown (md) document"
    )]
    pub markdown_file_id: String,
    #[schemars(
        description = "Instructions for the revision agent to follow to edit the markdown. These instructions will be provided by the user."
    )]
    pub instructions: String,
}

#[async_trait]
impl AsyncTool<Arc<ToolScribe>> for MarkdownRewrite {
    type Output = AIDiffResponse;

    #[tracing::instrument(skip_all, fields(user_id=?(*request_context.user_id).as_ref()), err)]
    async fn call(
        &self,
        scribe: ServiceContext<Arc<ToolScribe>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(markdown_file_id=?self.markdown_file_id, "Rewrite params");

        rewrite_markdown(self.clone(), &scribe)
            .await
            .map_err(|err| ToolCallError {
                description: "An internal error occured rewriting generating rewrite".into(),
                internal_error: err,
            })
    }
}

pub async fn rewrite_markdown(
    request: MarkdownRewrite,
    scribe: &ToolScribe,
) -> Result<AIDiffResponse, Error> {
    let document = scribe
        .document
        .fetch(request.markdown_file_id.clone())
        .document_content()
        .await?;
    if document.file_type() != FileType::Md {
        Err(anyhow::anyhow!("expected markdown"))
    } else {
        let name = document.metadata().document_name.clone();
        let md_text = document.content.text_content()?;
        generate_patches(request, md_text, name).await
    }
}

pub async fn generate_patches(
    request: MarkdownRewrite,
    markdown_text: String,
    file_name: String,
) -> Result<AIDiffResponse, Error> {
    let attachment_content = attachment::AttachmentContent {
        reference: model_entity::EntityType::Document.with_entity_string(request.markdown_file_id),
        name: Some(file_name),
        content: non_empty::NonEmpty::one(attachment::AttachmentPart::Content(markdown_text)),
    };
    let attachments =
        attachment::Attachments::new(non_empty::NonEmpty::one(Ok(attachment_content)));

    let request = RequestBuilder::new()
        .max_tokens(32_000)
        .system_prompt(PROMPT)
        .model(REWRITE_MODEL)
        .attachments(attachments)
        .messages(vec![
            MessageBuilder::new()
                .content(request.instructions)
                .user()
                .build(),
        ])
        .build();

    ai::structured_output_v2::structured_completion_v2::<AIDiffResponse>(request).await
}
