//! Composition of image generation with document uploads and reference-image reads.
use super::{ToolDocumentService, ToolDocumentToolContext, ToolEntityAccessService};
use std::sync::Arc;

macro_env_var::env_var! {
    /// Static file bucket, used only with local AWS.
    pub struct StaticStorageBucket;
}

/// Reference photos resolved by their owning domains.
pub type ToolImageReferenceReader =
    image_generation::outbound::references::AttachmentImageReferenceReader<
        documents::inbound::attachment::DocumentAttachmentService<
            ToolDocumentService,
            ToolEntityAccessService,
        >,
        static_file::inbound::attachment::StaticFileAttachmentService<
            static_file::outbound::CdnStaticFileRepo,
        >,
    >;

/// Image generation service composed with the document upload capability.
pub type ToolImageGenerationService = image_generation::domain::service::ImageGenerationServiceImpl<
    image_generation::outbound::documents::DocumentsImageStore<
        documents::inbound::toolset::DefaultDocumentToolCreator<ToolDocumentService>,
    >,
    ToolImageReferenceReader,
>;

/// Image-generation context shared by all AI hosts.
pub type ToolImageGenerationToolContext =
    image_generation::inbound::toolset::ImageGenerationToolContext<
        ToolImageGenerationService,
        ToolEntityAccessService,
    >;

/// Compose image generation with an already-wired document upload service.
pub fn build_image_generation_tool_context(
    documents: &ToolDocumentToolContext,
    generator: Arc<dyn image_generation::domain::ports::ImageGenerator>,
) -> anyhow::Result<ToolImageGenerationToolContext> {
    // Local service URLs address the API container, while public file bytes
    // live in the static-file bucket. Providers receive bytes from this reader.
    let cdn_base = if let Some(local_aws) = macro_aws_config::LocalAwsUrl::new() {
        format!(
            "{}/{}",
            local_aws.as_ref().trim_end_matches('/'),
            StaticStorageBucket::new()?.as_ref(),
        )
    } else {
        macro_service_urls::StaticFileServiceUrl::new()?.to_string()
    };
    Ok(build_with_cdn(documents, generator, cdn_base))
}

fn build_with_cdn(
    documents: &ToolDocumentToolContext,
    generator: Arc<dyn image_generation::domain::ports::ImageGenerator>,
    cdn_base: String,
) -> ToolImageGenerationToolContext {
    let references = image_generation::outbound::references::AttachmentImageReferenceReader::new(
        documents::inbound::attachment::DocumentAttachmentService::new(
            documents.service.clone(),
            documents.entity_access_service.clone(),
            documents.lexical_client.clone(),
        ),
        static_file::inbound::attachment::StaticFileAttachmentService::new(Arc::new(
            static_file::outbound::CdnStaticFileRepo::new(cdn_base),
        )),
    );
    image_generation::inbound::toolset::ImageGenerationToolContext::new(
        image_generation::domain::service::ImageGenerationServiceImpl::new(
            generator,
            image_generation::outbound::documents::DocumentsImageStore::new(
                documents.creator.clone(),
            ),
        )
        .with_reference_reader(references),
        documents.entity_access_service.clone(),
        documents.actor,
    )
}

/// Test context with an explicitly unconfigured image provider.
#[cfg(any(test, feature = "test-support"))]
pub fn build_image_generation_tool_context_test(
    documents: &ToolDocumentToolContext,
) -> ToolImageGenerationToolContext {
    build_with_cdn(
        documents,
        Arc::new(image_generation::domain::ports::UnconfiguredImageGenerator),
        "https://static.example.test".to_string(),
    )
}
