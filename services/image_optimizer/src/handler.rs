use lambda_runtime::Error;
use std::collections::HashMap;

use crate::request::{AsyncResizeRequest, FunctionUrlRequest};
use crate::response::{FunctionUrlResponse, error_response, image_response};
use crate::transform::{TransformParams, transform_image};
use crate::{AppContext, DEFAULT_CACHE_TTL, s3};

/// Performs the actual image transform and caches the result in S3.
///
/// 1. Fetch the original from S3.
/// 2. Attempt the transform — on failure, fall back to the original so we still
///    cache something at the variant key (prevents repeated retries).
/// 3. Store the result at the variant S3 key with a long-lived cache header.
///    Future requests hit S3/CloudFront directly without invoking the Lambda.
#[tracing::instrument(skip(ctx), fields(key = %req.transformed_s3_key), err)]
pub async fn handle_async_resize(
    ctx: &AppContext,
    req: AsyncResizeRequest,
) -> Result<FunctionUrlResponse, Error> {
    // 1. Fetch the original file from S3.
    let (original_bytes, content_type) =
        s3::fetch(&ctx.s3_client, &ctx.bucket, &req.original_key).await?;

    let params = TransformParams::from_async_request(&req);
    let original_mime = content_type
        .as_deref()
        .unwrap_or("application/octet-stream");

    // 2. Transform. On failure (unsupported format, corrupt file, etc.) cache the
    //    original at the variant key so the next request is served from S3 without
    //    re-invoking the Lambda.
    let (bytes, mime) = match transform_image(&original_bytes, &params) {
        Ok((transformed_bytes, output_format)) => (transformed_bytes, output_format.to_mime_type()),
        Err(e) => {
            tracing::warn!(error=?e, "transform failed, caching original at transformed key");
            (original_bytes, original_mime)
        }
    };

    // 3. Store the result at the variant S3 key.
    s3::store(
        &ctx.s3_client,
        &ctx.bucket,
        &req.transformed_s3_key,
        bytes,
        mime,
        DEFAULT_CACHE_TTL,
    )
    .await?;

    Ok(FunctionUrlResponse {
        status_code: 200,
        headers: HashMap::new(),
        body: None,
        is_base64_encoded: false,
    })
}

/// Handles a CloudFront origin-group failover request.
///
/// The CF URL rewrite function has already resolved `format=auto` and rewritten
/// the URI from `/file/{uuid}?size=1080&format=avif` to
/// `/file/{uuid}/format=avif,size=1080`. S3 (primary origin) returned 403/404,
/// so the request failed over here.
///
/// 1. File ID and transform suffix are extracted from `rawPath` during deserialization.
/// 2. Fetch the original from S3.
/// 3. No transform suffix → serve the original with long-lived cache headers.
/// 4. Has suffix → fire-and-forget an async self-invocation to resize and cache
///    the variant, then return the original with `no-cache` so the next request
///    hits the now-cached variant in S3.
#[tracing::instrument(skip(ctx, request), fields(file_id), err)]
pub async fn handle_cloudfront_request(
    ctx: &AppContext,
    request: FunctionUrlRequest,
) -> Result<FunctionUrlResponse, Error> {
    // 1. File ID and transform suffix are extracted during deserialization.
    let Some(file_id) = &request.path.file_id else {
        return Ok(error_response(400, "Invalid request path"));
    };
    tracing::Span::current().record("file_id", file_id.as_str());

    // 2. Fetch the original from S3.
    let original_key = format!("file/{file_id}");

    let (original_bytes, content_type) =
        match s3::fetch(&ctx.s3_client, &ctx.bucket, &original_key).await {
            Ok(result) => result,
            Err(e) => {
                tracing::warn!(error=?e, "original not found");
                return Ok(error_response(404, "Image not found"));
            }
        };

    let original_mime = content_type
        .as_deref()
        .unwrap_or("application/octet-stream");

    let cache_control = format!("public, max-age={DEFAULT_CACHE_TTL}");

    // 3. No transform suffix → serve original with long-lived cache.
    let Some(suffix) = &request.path.transform_suffix else {
        return Ok(image_response(
            200,
            &original_bytes,
            original_mime,
            &cache_control,
        ));
    };

    // 4. Parse the suffix with serde_urlencoded and kick off async resize.
    //    Return the original immediately with no-cache headers; the async
    //    invocation stores the resized variant at the transformed S3 key so
    //    CloudFront serves it on subsequent requests.
    let Some(params) = TransformParams::from_suffix(suffix) else {
        return Ok(error_response(400, "Invalid transform parameters"));
    };

    let transformed_s3_key = format!("file/{file_id}/{suffix}");

    let async_request = AsyncResizeRequest {
        original_key,
        transformed_s3_key,
        size: params.size,
    };

    let payload = serde_json::to_vec(&async_request)?;
    ctx.lambda_client
        .invoke()
        .function_name(&ctx.function_name)
        .invocation_type(aws_sdk_lambda::types::InvocationType::Event)
        .payload(aws_sdk_lambda::primitives::Blob::new(payload))
        .send()
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to invoke async resize"))
        .ok();

    Ok(image_response(
        200,
        &original_bytes,
        original_mime,
        "no-store, no-cache, must-revalidate",
    ))
}
