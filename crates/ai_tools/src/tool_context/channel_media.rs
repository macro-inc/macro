//! Composition of channel media uploads with the static file service.

/// Reserves direct uploads of channel images and videos in static-file storage.
pub type ToolChannelMediaUploadToolContext =
    channels::inbound::toolset::ChannelMediaUploadToolContext<
        channels::outbound::static_file_media_uploads::StaticFileMediaUploads,
    >;

/// Reserve channel media through the static file service's internal API.
pub fn build_channel_media_upload_tool_context() -> anyhow::Result<ToolChannelMediaUploadToolContext>
{
    Ok(with_client(
        static_file_service_client::StaticFileServiceClient::new(
            macro_auth::InternalApiKey::new()?.to_string(),
            macro_service_urls::StaticFileServiceUrl::new()?.to_string(),
        ),
    ))
}

fn with_client(
    client: static_file_service_client::StaticFileServiceClient,
) -> ToolChannelMediaUploadToolContext {
    channels::inbound::toolset::ChannelMediaUploadToolContext::new(
        channels::outbound::static_file_media_uploads::StaticFileMediaUploads::new(client),
    )
}

/// Test context pointing at an unreachable static file service.
#[cfg(any(test, feature = "test-support"))]
pub fn build_channel_media_upload_tool_context_test() -> ToolChannelMediaUploadToolContext {
    with_client(static_file_service_client::StaticFileServiceClient::new(
        "test-key".to_string(),
        "https://static.example.test".to_string(),
    ))
}
