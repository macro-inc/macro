use super::types::AIDiffResponse;
use super::types::{PROMPT, REWRITE_MODEL};
use crate::tool_context::{RequestContext, ToolScribe, ToolServiceContext};
use ai::tool::{AsyncTool, ToolCallError, ToolResult};
use ai::types::{MessageBuilder, PromptAttachment, RequestBuilder};
use anyhow::Error;
use async_trait::async_trait;
use model::document::FileType;
use schemars::JsonSchema;
use serde::Deserialize;

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
impl AsyncTool<ToolServiceContext, RequestContext> for MarkdownRewrite {
    type Output = AIDiffResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        sc: ToolServiceContext,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(markdown_file_id=?self.markdown_file_id, "Rewrite params");

        rewrite_markdown(self.clone(), &sc.scribe, &request_context.user_id)
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
    _user_id: &str,
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
    let request = RequestBuilder::new()
        .max_tokens(32_000)
        .system_prompt(PROMPT)
        .model(REWRITE_MODEL)
        .add_text_attachment(PromptAttachment {
            content: markdown_text,
            file_type: "md".into(),
            id: request.markdown_file_id,
            name: file_name,
        })
        .messages(vec![
            MessageBuilder::new()
                .content(request.instructions)
                .user()
                .build(),
        ])
        .build();

    ai::structured_output_v2::structured_completion_v2::<AIDiffResponse>(request).await
}
