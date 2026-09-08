//! Rendering a model-authored email body through the lexical service.
//!
//! Lives here rather than in `email`'s outbound layer because
//! `lexical_client` depends on `email` transitively; the port is declared in
//! the email domain and implemented on this side of that edge.

use email::domain::models::EmailErr;
use email::domain::ports::{MarkdownEmailRenderer, RenderedEmailBody};
use lexical_client::LexicalClient;
use std::sync::Arc;

/// Renders Markdown into an email body with the same Lexical nodes and
/// transformers the draft composer uses in the browser.
pub struct LexicalMarkdownEmailRenderer {
    client: Arc<LexicalClient>,
}

impl LexicalMarkdownEmailRenderer {
    /// Create a renderer backed by the lexical service.
    pub fn new(client: Arc<LexicalClient>) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl MarkdownEmailRenderer for LexicalMarkdownEmailRenderer {
    async fn render(&self, markdown: &str) -> Result<RenderedEmailBody, EmailErr> {
        let rendered = self
            .client
            .markdown_to_html(markdown)
            .await
            .map_err(EmailErr::RepoErr)?;

        Ok(RenderedEmailBody {
            html: rendered.html,
            text: rendered.text,
        })
    }
}
