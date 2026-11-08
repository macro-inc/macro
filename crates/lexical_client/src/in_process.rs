//! Host capabilities and owned model adapters; authorization stays with callers.
use anyhow::Result;
use macro_document_model::{DocumentContext, NodeClock, NodeHost, NodeRandom};
use serde::{Serialize, de::DeserializeOwned};
use std::sync::Arc;

pub(crate) fn context() -> DocumentContext {
    DocumentContext {
        clock: NodeClock(Arc::new(|| {
            chrono::Utc::now().timestamp_millis().unsigned_abs()
        })),
        random: NodeRandom(Arc::new(|length| {
            let mut bytes = vec![0; length];
            if getrandom::fill(&mut bytes).is_err() {
                bytes.clear();
            }
            bytes
        })),
        host: NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    }
}

// Blocking model work enters the route span captured after dispatch selects it.
// Owned inputs keep borrowed request data out of the blocking pool.
pub(crate) async fn run<T: Send + 'static>(
    operation: impl FnOnce(&DocumentContext) -> Result<T> + Send + 'static,
) -> Result<T> {
    let span = tracing::Span::current();
    tokio::task::spawn_blocking(move || span.in_scope(|| operation(&context()))).await?
}

// The retained client and the model deliberately have different ownership/type
// boundaries. Convert through their serde contracts, retaining wire scalars.
pub(crate) fn wire<T: DeserializeOwned>(value: impl Serialize) -> Result<T> {
    Ok(serde_json::from_value(serde_json::to_value(value)?)?)
}

pub(crate) async fn markdown_snapshot(markdown: &str) -> Result<Vec<u8>> {
    let markdown = markdown.to_owned();
    run(move |context| {
        Ok(macro_document_model::snapshot::markdown_to_loro_snapshot(
            &markdown, context,
        )?)
    })
    .await
}

pub(crate) async fn notion_snapshot(
    request: &crate::notion::NotionSnapshotRequest<'_>,
) -> Result<crate::notion::NotionSnapshot> {
    let markdown = request.markdown.to_owned();
    let links = wire(&request.links)?;
    run(move |context| {
        let result = macro_document_model::snapshot::notion_markdown_to_loro_snapshot(
            &markdown, &links, context,
        )?;
        Ok(crate::notion::NotionSnapshot {
            snapshot: result.snapshot,
            markdown: result.markdown,
        })
    })
    .await
}

pub(crate) async fn mentions(
    markdown: &str,
) -> Result<Vec<crate::parse_markdown::ExtractedMention>> {
    let markdown = markdown.to_owned();
    run(move |context| {
        wire(
            macro_document_model::mentions::extract_channel_mentions_from_markdown(
                &markdown, context,
            )?,
        )
    })
    .await
}

pub(crate) async fn extract_reply(
    markdown: &str,
) -> Result<Option<crate::parse_markdown::ExtractedExplicitReply>> {
    let markdown = markdown.to_owned();
    run(move |context| {
        wire(macro_document_model::mentions::extract_explicit_reply(
            &markdown, context,
        )?)
    })
    .await
}

pub(crate) async fn html(markdown: &str) -> Result<crate::parse_markdown::RenderedBody> {
    let markdown = markdown.to_owned();
    run(move |context| {
        wire(macro_document_model::html::markdown_to_html(
            &markdown,
            &Default::default(),
            context,
        )?)
    })
    .await
}

pub(crate) async fn image(
    input: &crate::parse_markdown::ImageMarkdownRequest<'_>,
) -> Result<String> {
    let input = serde_json::to_value(input)?;
    run(move |context| {
        Ok(macro_document_composers::wire::handle_image_markdown(&input, context)?.markdown)
    })
    .await
}

pub(crate) async fn announcement(input: impl Serialize) -> Result<String> {
    let input = serde_json::to_value(input)?;
    run(move |context| {
        Ok(macro_document_composers::wire::handle_agent_announcement(&input, context)?.markdown)
    })
    .await
}

pub(crate) async fn agent_context(
    input: &crate::parse_markdown::AgentContextRequest<'_>,
) -> Result<String> {
    let input = serde_json::to_value(input)?;
    run(move |context| {
        Ok(macro_document_composers::wire::handle_agent_context(&input, context)?.markdown)
    })
    .await
}

#[cfg(test)]
mod test;
