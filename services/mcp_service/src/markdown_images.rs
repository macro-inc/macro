use ai_tools::ToolServiceContext;
use async_trait::async_trait;
use attachment::image::ImageData;
use documents::domain::{
    models::LocationQueryParams, ports::DocumentService, response::LocationResponseV3,
};
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::model::{CallToolResult, Content};
use std::net::IpAddr;
use std::sync::OnceLock;
use url::Url;

#[cfg(test)]
mod test;

const MAX_MARKDOWN_IMAGES: usize = 8;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedImage {
    pub data: String,
    pub mime_type: String,
}

#[async_trait]
pub(crate) trait MarkdownImageResolver: Send + Sync {
    async fn resolve_static(&self, url: &str) -> Option<ResolvedImage>;
    async fn resolve_dss(&self, user_id: &MacroUserIdStr<'_>, id: &str) -> Option<ResolvedImage>;
}

#[cfg(test)]
#[async_trait]
impl MarkdownImageResolver for () {
    async fn resolve_static(&self, _url: &str) -> Option<ResolvedImage> {
        None
    }

    async fn resolve_dss(&self, _user_id: &MacroUserIdStr<'_>, _id: &str) -> Option<ResolvedImage> {
        None
    }
}

#[async_trait]
impl MarkdownImageResolver for ToolServiceContext {
    async fn resolve_static(&self, url: &str) -> Option<ResolvedImage> {
        fetch_public_and_encode(url).await
    }

    async fn resolve_dss(&self, user_id: &MacroUserIdStr<'_>, id: &str) -> Option<ResolvedImage> {
        let ctx = &self.document_tool_context;
        let receipt = ctx
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user_id,
                None,
                id,
                EntityType::Document,
            )
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, id, "mcp dss image access denied");
            })
            .ok()?;
        let document = ctx
            .service
            .internal_get_basic_document(id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, id, "mcp dss image document missing");
            })
            .ok()?;
        let location = ctx
            .service
            .get_document_location(
                &document,
                receipt,
                LocationQueryParams {
                    get_converted_docx_url: Some(true),
                    document_version_id: None,
                },
            )
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, id, "mcp dss image location failed");
            })
            .ok()?;
        let LocationResponseV3::PresignedUrl { presigned_url, .. } = location else {
            tracing::warn!(id, "mcp dss image had no presigned url");
            return None;
        };
        fetch_and_encode(&presigned_url).await
    }
}

pub(crate) async fn tool_result_with_images<R: MarkdownImageResolver>(
    resolver: &R,
    user_id: &MacroUserIdStr<'_>,
    value: serde_json::Value,
) -> CallToolResult {
    let images = resolve_markdown_images(resolver, user_id, &value).await;
    let mut result = CallToolResult::structured(value);
    result.content.extend(
        images
            .into_iter()
            .map(|image| Content::image(image.data, image.mime_type)),
    );
    result
}

async fn resolve_markdown_images<R: MarkdownImageResolver>(
    resolver: &R,
    user_id: &MacroUserIdStr<'_>,
    value: &serde_json::Value,
) -> Vec<ResolvedImage> {
    let refs = markdown_image_refs(value);
    if refs.len() > MAX_MARKDOWN_IMAGES {
        tracing::warn!(
            count = refs.len(),
            max = MAX_MARKDOWN_IMAGES,
            "skipping markdown images beyond the MCP cap"
        );
    }

    let mut images = Vec::new();
    for image_ref in refs.into_iter().take(MAX_MARKDOWN_IMAGES) {
        let resolved = match image_ref {
            ImageRef::Static(url) => resolver.resolve_static(&url).await,
            ImageRef::Dss(id) => resolver.resolve_dss(user_id, &id).await,
        };
        if let Some(image) = resolved {
            images.push(image);
        }
    }
    images
}

#[derive(Debug, PartialEq, Eq)]
enum ImageRef {
    Static(String),
    Dss(String),
}

fn markdown_image_refs(value: &serde_json::Value) -> Vec<ImageRef> {
    let Some(nodes) = value
        .get("content")
        .and_then(|content| content.get("markdown"))
        .and_then(|markdown| markdown.as_array())
    else {
        return Vec::new();
    };

    nodes
        .iter()
        .filter_map(|node| {
            let node_type = node.get("type")?.as_str()?;
            match node_type {
                "staticImage" => node
                    .get("url")
                    .and_then(|url| url.as_str())
                    .map(|url| ImageRef::Static(url.to_owned())),
                "dssImage" => node
                    .get("id")
                    .and_then(|id| id.as_str())
                    .map(|id| ImageRef::Dss(id.to_owned())),
                _ => None,
            }
        })
        .collect()
}

async fn fetch_public_and_encode(url: &str) -> Option<ResolvedImage> {
    match fetch_public_and_encode_inner(url).await {
        Ok(image) => Some(image),
        Err(error) => {
            tracing::warn!(error=?error, url, "failed to fetch public markdown image for MCP");
            None
        }
    }
}

async fn fetch_public_and_encode_inner(url: &str) -> anyhow::Result<ResolvedImage> {
    let url = assert_public_http_url(url).await?;
    let response = static_http_client().get(url.as_str()).send().await?;
    encode_response(url.as_str(), response).await
}

async fn fetch_and_encode(url: &str) -> Option<ResolvedImage> {
    match fetch_and_encode_inner(url).await {
        Ok(image) => Some(image),
        Err(error) => {
            tracing::warn!(error=?error, url, "failed to fetch markdown image for MCP");
            None
        }
    }
}

async fn fetch_and_encode_inner(url: &str) -> anyhow::Result<ResolvedImage> {
    let url = macro_aws_config::transform_aws_url_for_internal_fetch(url);
    let url = url.as_str();
    let response = reqwest::get(url).await?;
    encode_response(url, response).await
}

async fn encode_response(url: &str, response: reqwest::Response) -> anyhow::Result<ResolvedImage> {
    if !response.status().is_success() {
        anyhow::bail!("failed to fetch {url}: HTTP {}", response.status());
    }
    let bytes = read_body_capped(response, MAX_IMAGE_BYTES).await?;
    match ImageData::try_from_bytes(bytes)? {
        ImageData::Base64(image) => Ok(ResolvedImage {
            data: image.base64_data().to_owned(),
            mime_type: "image/webp".to_owned(),
        }),
        ImageData::StaticUrl(_) => anyhow::bail!("image encoder returned a url"),
    }
}

async fn read_body_capped(mut response: reqwest::Response, max: usize) -> anyhow::Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|content_length| content_length > max as u64)
    {
        anyhow::bail!("image exceeds {max} bytes");
    }
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if out.len().saturating_add(chunk.len()) > max {
            anyhow::bail!("image exceeds {max} bytes");
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn static_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("static image client")
    })
}

async fn assert_public_http_url(raw: &str) -> anyhow::Result<Url> {
    let url = Url::parse(raw)?;
    if url.scheme() != "http" && url.scheme() != "https" {
        anyhow::bail!("only http/https image urls");
    }
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("missing host"))?;
    let port = url.port_or_known_default().unwrap_or(80);
    for addr in tokio::net::lookup_host((host, port)).await? {
        if is_private_ip(addr.ip()) {
            anyhow::bail!("private image url");
        }
    }
    Ok(url)
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
        }
        IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(mapped_v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}
