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

#[cfg(test)]
mod test;

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
        fetch_and_encode(url).await
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
    let mut images = Vec::new();
    for image_ref in markdown_image_refs(value) {
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
    if !response.status().is_success() {
        anyhow::bail!("failed to fetch {url}: HTTP {}", response.status());
    }
    let bytes = response.bytes().await?.to_vec();
    match ImageData::try_from_bytes(bytes)? {
        ImageData::Base64(image) => Ok(ResolvedImage {
            data: image.base64_data().to_owned(),
            mime_type: "image/webp".to_owned(),
        }),
        ImageData::StaticUrl(_) => anyhow::bail!("image encoder returned a url"),
    }
}
