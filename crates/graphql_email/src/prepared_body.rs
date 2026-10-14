//! Server-side reader preparation of email bodies (`email_utils::prepare`).

use std::sync::LazyLock;

use async_graphql::SimpleObject;
use email_utils::prepare::{
    BodyOptions, EmailBodyInput, ImagePolicy, PREPARE_VERSION, RemoteImages, prepare_email_body,
};
use macro_service_urls::ImageProxyServiceUrl;

/// Bodies above this many bytes of source prepare on the blocking pool, so a
/// large newsletter cannot stall the async runtime.
const BLOCKING_THRESHOLD: usize = 64 * 1024;

/// This environment's `img[src]` proxy endpoint, matching the web app's.
static IMAGE_PROXY_URL: LazyLock<Option<String>> = LazyLock::new(|| {
    ImageProxyServiceUrl::new()
        .inspect_err(|error| tracing::warn!(?error, "image proxy URL unavailable"))
        .ok()
        .map(|url| format!("{}/proxy", url.trim_end_matches('/')))
});

/// A message body prepared for the reader's default view: quoted history and
/// signature collapsed, remote images through this environment's proxy.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlPreparedEmailBody {
    /// The preparation version that produced `html`.
    pub version: i32,
    /// Sanitized HTML for the web renderer's mount, head styles first.
    pub html: String,
    /// Whether the shown content contains a table.
    pub has_table: bool,
    /// Whether quoted history or a signature was hidden.
    pub has_hidden_content: bool,
    /// The proxy applied to `img[src]`. A client using another proxy prepares
    /// the body itself.
    pub image_proxy_url: Option<String>,
    /// UTF-16 length of the HTML and replyless HTML this was prepared from, so
    /// a client holding a different source prepares the body itself.
    pub source_length: i32,
}

/// Prepares `html` when `version` is this server's; otherwise `None`, so the
/// client prepares the body itself.
pub(crate) async fn prepare(
    version: i32,
    html: Option<&str>,
    replyless_html: Option<&str>,
) -> async_graphql::Result<Option<GraphqlPreparedEmailBody>> {
    let Some(html) = html.filter(|html| !html.is_empty()) else {
        return Ok(None);
    };
    if version != PREPARE_VERSION {
        return Ok(None);
    }
    let large = html.len() + replyless_html.map_or(0, str::len) > BLOCKING_THRESHOLD;
    let source_length = utf16_len(html) + replyless_html.map_or(0, utf16_len);
    let html = html.to_owned();
    let replyless_html = replyless_html.map(str::to_owned);
    let image_proxy_url = IMAGE_PROXY_URL.clone();
    let proxy_url = image_proxy_url.clone();
    let run = move || {
        prepare_email_body(
            &EmailBodyInput {
                html: Some(&html),
                replyless_html: replyless_html.as_deref(),
                text: None,
            },
            &BodyOptions {
                images: ImagePolicy {
                    remote: RemoteImages::Allow,
                    proxy_url,
                },
                ..BodyOptions::default()
            },
        )
    };
    let body = if large {
        tokio::task::spawn_blocking(run).await?
    } else {
        run()
    };
    Ok(Some(GraphqlPreparedEmailBody {
        version,
        html: body.html,
        has_table: body.has_table,
        has_hidden_content: body.has_hidden_content,
        image_proxy_url,
        source_length: i32::try_from(source_length).unwrap_or(i32::MAX),
    }))
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

#[cfg(test)]
mod test;
