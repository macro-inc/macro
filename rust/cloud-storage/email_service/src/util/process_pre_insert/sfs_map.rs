use anyhow::{Context, bail};
use bytes::BytesMut;
use futures::{StreamExt, stream};
use lol_html::html_content::Element;
use lol_html::{HtmlRewriter, Settings, element};
use models_email::email::service::{message, thread};
use scraper::{Html, Selector};
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::time::Duration;
use url::Url;

const MAX_IMAGE_SIZE_BYTES: usize = 10 * 1024 * 1024; // 10 MB
const REQUEST_TIMEOUT_SECONDS: u64 = 15;
const CONNECT_TIMEOUT_SECONDS: u64 = 5;
const MAX_REDIRECTS: usize = 5;

// concurrently calls store_messages_images for each message in each passed thread
pub async fn store_threads_images(
    threads_vec: &mut [thread::Thread],
    db: &PgPool,
    sfs_client: &StaticFileServiceClient,
) {
    if cfg!(feature = "disable_sfs_map") {
        return;
    }

    let mut image_processing_tasks = Vec::new();

    for thread_data in threads_vec.iter_mut() {
        for message in thread_data.messages.iter_mut() {
            let msg_provider_id = message.provider_id.clone().unwrap_or_default();
            let thread_provider_id = thread_data.provider_id.clone().unwrap_or_default();

            let task = async move {
                let result = store_message_images(db, sfs_client, message).await;
                (result, msg_provider_id, thread_provider_id)
            };
            image_processing_tasks.push(task);
        }
    }

    // Limit to 10 concurrent tasks
    const MAX_CONCURRENT: usize = 10;

    // Process tasks with limited concurrency
    let results_with_ids = stream::iter(image_processing_tasks)
        .buffer_unordered(MAX_CONCURRENT)
        .collect::<Vec<_>>()
        .await;

    for (result, msg_provider_id, thread_provider_id) in results_with_ids {
        if let Err(e) = result {
            tracing::error!(
                msg_provider_id = %msg_provider_id,
                thread_id = %thread_provider_id,
                error = ?e,
                "Error processing images for message"
            );
        }
    }
}

/// stores a message's URL-referenced images in SFS and updates the html of the message to
/// use the new SFS links.
pub async fn store_message_images(
    db: &PgPool,
    sfs_client: &StaticFileServiceClient,
    msg: &mut message::Message,
) -> anyhow::Result<()> {
    if msg.body_html_sanitized.is_none() {
        return Ok(());
    }

    let body_html = msg.body_html_sanitized.as_ref().unwrap();

    // extract the image URLs we need to replace
    let urls = extract_all_image_urls(body_html).context("failed to extract image urls")?;

    if !urls.is_empty() {
        // cache the images in SFS and return the new links
        let sfs_map = cache_images(db, sfs_client, urls.clone())
            .await
            .context("failed to cache images")?;

        if !sfs_map.is_empty() {
            // update the message html body to use the new links
            let new_html = rewrite_html_image_links(body_html, &sfs_map)
                .context("failed to rewrite image URLs")?;

            msg.body_html_sanitized = Some(new_html);
        }
    }
    Ok(())
}

// extracts the src/srcset attributes from all <img> tags in the passed HTML
fn extract_all_image_urls(html_content: &str) -> anyhow::Result<HashSet<String>> {
    let document = Html::parse_document(html_content);
    let mut image_urls = HashSet::new();

    let img_selector = Selector::parse("img")
        .map_err(|e| anyhow::anyhow!("Failed to parse 'img' selector: {:?}", e))?;

    for element in document.select(&img_selector) {
        if let Some(src) = element.value().attr("src") {
            let src_trimmed = src.trim();
            if !src_trimmed.is_empty() && src_trimmed.starts_with("http") {
                // not covering CID/relative URL cases for now
                image_urls.insert(src_trimmed.to_string());
            }
        }
        if let Some(srcset) = element.value().attr("srcset") {
            for part in srcset.split(',') {
                let url_candidate = part.split_whitespace().next().unwrap_or("").trim();
                if !url_candidate.is_empty() && url_candidate.starts_with("http") {
                    // not covering CID/relative URL cases for now
                    image_urls.insert(url_candidate.to_string());
                }
            }
        }
    }
    Ok(image_urls)
}

// wrapper function for fetching and caching images in parallel
async fn cache_images(
    db: &PgPool,
    sfs_client: &StaticFileServiceClient,
    source_urls: HashSet<String>,
) -> anyhow::Result<HashMap<String, String>> {
    // filter out values that already exist in db or are already sfs urls
    let mut url_map = email_db_client::sfs_mappings::fetch_sfs_mappings(db, &source_urls).await?;

    let new_urls: HashSet<_> = source_urls
        .into_iter()
        .filter(|url| {
            !(url_map.contains_key(url)
                || url.starts_with("static-file-service")
                || url.starts_with("https://linkprotect.cudasvc.com"))
        })
        .collect();

    if !new_urls.is_empty() {
        // fetch and upload each image to sfs concurrently
        let mut futures = Vec::new();
        for source_url in new_urls {
            let url_to_process = source_url.clone();
            let sfs_client = sfs_client.clone();
            futures.push(async move {
                // In a real scenario, pass base_url and email_mime_parts here
                match fetch_and_upload_to_sfs(sfs_client, &url_to_process).await {
                    Ok(Some(sfs_url)) => Some(sfs_url),
                    Ok(None) => None,
                    Err(_) => None,
                }
            });
        }

        let results = futures::future::join_all(futures).await;
        for (source_url, sfs_url) in results.into_iter().flatten() {
            url_map.insert(source_url, sfs_url);
        }

        if let Err(e) = email_db_client::sfs_mappings::insert_sfs_mappings(db, &url_map).await {
            tracing::warn!(error = ?e, "Failed to asynchronously insert SFS mappings into database");
        }
    }

    Ok(url_map)
}

// fetches the data from the url, stores it in sfs, and returns a tuple of the source and new urls
pub async fn fetch_and_upload_to_sfs(
    sfs_client: StaticFileServiceClient,
    original_url_str: &str,
) -> anyhow::Result<Option<(String, String)>> {
    let url_to_fetch = match Url::parse(original_url_str) {
        Ok(mut url) => {
            if url.scheme() != "http" && url.scheme() != "https" {
                tracing::warn!("Skipping URL with non-HTTP(S) scheme: {}", original_url_str);
                return Ok(None);
            }
            url.set_fragment(None); // normalizing
            url
        }
        Err(_) => {
            tracing::warn!("Skipping non-URL for SFS storage: {}", original_url_str);
            return Ok(None);
        }
    };

    // use safe defaults to prevent timeouts/redirect trolling
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECONDS))
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .build()
        .context("failed to build reqwest client")?;

    let response = match client.get(url_to_fetch.as_str()).send().await {
        Ok(response) => response,
        Err(e) => {
            let error_chain = build_error_chain(&e);
            if e.is_timeout() {
                return Err(anyhow::anyhow!(
                    "Timeout fetching URL: {} - Full error: {}",
                    original_url_str,
                    error_chain
                ));
            } else if e.is_connect() {
                return Err(anyhow::anyhow!(
                    "Connection error for URL: {} - Full error: {}",
                    original_url_str,
                    error_chain
                ));
            }
            return Err(anyhow::anyhow!(
                "Network error fetching URL: {} - Full error: {}",
                original_url_str,
                error_chain
            ));
        }
    };

    if !response.status().is_success() {
        bail!(
            "Remote server returned error for {}: HTTP {}",
            original_url_str,
            response.status()
        );
    }

    if let Some(content_length) = response.content_length()
        && content_length > MAX_IMAGE_SIZE_BYTES as u64
    {
        bail!(
            "Image at {} is too large (Content-Length: {} bytes)",
            original_url_str,
            content_length
        );
    }

    // Stream response data with a hard cap
    let mut image_data_stream = response.bytes_stream();
    let mut image_data_bytes = BytesMut::new();
    while let Some(chunk_result) = image_data_stream.next().await {
        let chunk = chunk_result.context("Failed to read chunk from image stream")?;
        if (image_data_bytes.len() + chunk.len()) > MAX_IMAGE_SIZE_BYTES {
            bail!(
                "Image at {} is too large (exceeded {} bytes during streaming)",
                original_url_str,
                MAX_IMAGE_SIZE_BYTES
            );
        }
        image_data_bytes.extend_from_slice(&chunk);
    }
    let image_data = image_data_bytes.freeze();

    if image_data.is_empty() {
        return Err(anyhow::anyhow!(
            "Fetched empty image data from {}",
            original_url_str
        ));
    }

    let inferred_type = match infer::get(&image_data) {
        Some(t) => t,
        None => {
            bail!("Could not determine image type for {}", original_url_str);
        }
    };

    let validated_content_type = inferred_type.mime_type();
    if !validated_content_type.starts_with("image/") {
        bail!(
            "Image type '{}' from {} is not allowed.",
            validated_content_type,
            original_url_str
        );
    }

    let sfs_info = match sfs_client
        .put_file_with_bytes("a", image_data, validated_content_type.to_string())
        .await
    {
        Ok(info) => info,
        Err(e) => {
            return Err(anyhow::anyhow!("Failed to store image in SFS: {}", e));
        }
    };

    Ok(Some((original_url_str.to_string(), sfs_info.file_location)))
}

fn build_error_chain(err: &reqwest::Error) -> String {
    let mut error_chain = format!("{}", err);
    let mut source = err.source();

    while let Some(err) = source {
        error_chain.push_str(&format!("\nCaused by: {}", err));
        source = err.source();
    }

    error_chain
}

fn rewrite_html_image_links(
    original_html: &str,
    url_map: &HashMap<String, String>,
) -> anyhow::Result<String> {
    let mut output = Vec::new();
    let mut rewriter = HtmlRewriter::new(
        Settings {
            element_content_handlers: vec![
                // Handle <img> tags
                element!("img[src]", |el: &mut Element| {
                    if let Some(original_src) = el.get_attribute("src") {
                        let trimmed_original_src = original_src.trim();
                        if let Some(new_src) = url_map.get(trimmed_original_src)
                            && let Err(e) = el.set_attribute("src", new_src)
                        {
                            tracing::warn!("Failed to set src attribute: {}", e);
                        }
                    }
                    Ok(())
                }),
                element!("img[srcset]", |el: &mut Element| {
                    if let Some(original_srcset) = el.get_attribute("srcset") {
                        let mut new_srcset_parts = Vec::new();
                        let mut changed = false;
                        for part in original_srcset.split(',') {
                            let trimmed_part = part.trim();
                            let mut components = trimmed_part.split_whitespace();
                            if let Some(url_candidate) = components.next() {
                                let descriptor = components.collect::<Vec<&str>>().join(" ");
                                if let Some(new_url) = url_map.get(url_candidate) {
                                    new_srcset_parts.push(
                                        format!("{} {}", new_url, descriptor)
                                            .trim_end()
                                            .to_string(),
                                    );
                                    changed = true;
                                } else {
                                    new_srcset_parts.push(trimmed_part.to_string());
                                    // Keep original part
                                }
                            } else {
                                new_srcset_parts.push(trimmed_part.to_string());
                                // Malformed, keep original
                            }
                        }
                        if changed
                            && let Err(e) = el.set_attribute("srcset", &new_srcset_parts.join(", "))
                        {
                            tracing::warn!("Failed to set srcset attribute: {}", e);
                        }
                    }
                    Ok(())
                }),
            ],
            ..Settings::default()
        },
        |c: &[u8]| output.extend_from_slice(c),
    );

    rewriter.write(original_html.as_bytes()).with_context(|| {
        format!(
            "HTML rewriting error during write for input starting with: '{}'",
            original_html.chars().take(100).collect::<String>()
        )
    })?;

    rewriter
        .end()
        .context("HTML rewriting error during end phase")?;

    String::from_utf8(output).context("Rewritten HTML output is not valid UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_extract_all_image_urls_with_srcset() {
        // HTML with various srcset patterns
        let html_content = r#"
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Email with Srcset</title>
        </head>
        <body>
            <h1>Test Email</h1>

            <!-- Simple image with src only -->
            <img src="https://example.com/image1.jpg" alt="Basic image">

            <!-- Image with srcset only -->
            <img srcset="https://example.com/small.jpg 320w,
                        https://example.com/medium.jpg 800w,
                        https://example.com/large.jpg 1200w"
                 alt="Responsive image without src">

            <!-- Image with both src and srcset -->
            <img src="https://example.com/fallback.jpg"
                 srcset="https://example.com/image-400.jpg 400w,
                         https://example.com/image-800.jpg 800w"
                 sizes="(max-width: 600px) 100vw, 50vw"
                 alt="Complete responsive image">

            <!-- Real-world example with full URLs -->
            <img src="https://picsum.photos/600/300"
                 srcset="https://picsum.photos/320/160 320w,
                         https://picsum.photos/480/240 480w,
                         https://picsum.photos/600/300 600w"
                 alt="Photo from Lorem Picsum">

            <!-- Edge cases -->
            <img src="  https://example.com/image-with-spaces.jpg  " alt="Image with whitespace in src">
            <img srcset="
                https://example.com/newline-start.jpg 300w,
                https://example.com/newline-middle.jpg  600w,
                https://example.com/newline-end.jpg 900w
            " alt="Srcset with newlines">

            <!-- Non-HTTP protocols (should be ignored) -->
            <img src="data:image/png;base64,iVBORw0KGgo" alt="Data URL">
            <img src="cid:content-id-12345" alt="CID image">

            <!-- Duplicate URLs (should be deduplicated) -->
            <img src="https://example.com/duplicate.jpg" alt="First instance">
            <img src="https://example.com/duplicate.jpg" alt="Second instance">

            <!-- Same image in different sizes -->
            <img srcset="https://picsum.photos/id/237/200/300 200w,
                         https://picsum.photos/id/237/400/600 400w,
                         https://picsum.photos/id/237/800/1200 800w"
                 alt="Same image in different sizes">
        </body>
        </html>
        "#;

        // Call the function to test
        let result = extract_all_image_urls(html_content).unwrap();

        // Expected URLs to be extracted
        let expected_urls: HashSet<String> = [
            "https://example.com/image1.jpg",
            "https://example.com/small.jpg",
            "https://example.com/medium.jpg",
            "https://example.com/large.jpg",
            "https://example.com/fallback.jpg",
            "https://example.com/image-400.jpg",
            "https://example.com/image-800.jpg",
            "https://picsum.photos/600/300",
            "https://picsum.photos/320/160",
            "https://picsum.photos/480/240",
            "https://example.com/image-with-spaces.jpg",
            "https://example.com/newline-start.jpg",
            "https://example.com/newline-middle.jpg",
            "https://example.com/newline-end.jpg",
            "https://example.com/duplicate.jpg",
            "https://picsum.photos/id/237/200/300",
            "https://picsum.photos/id/237/400/600",
            "https://picsum.photos/id/237/800/1200",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        // Check that all expected URLs are present
        for url in &expected_urls {
            assert!(
                result.contains(url),
                "Expected URL '{}' was not found in extracted URLs: {:?}",
                url,
                result
            );
        }

        // Check for unexpected URLs
        for url in &result {
            assert!(
                expected_urls.contains(url),
                "Unexpected URL '{}' was found in extracted URLs",
                url
            );
        }

        // Verify count matches
        assert_eq!(
            result.len(),
            expected_urls.len(),
            "Expected {} URLs but found {}. \nExpected: {:?} \nFound: {:?}",
            expected_urls.len(),
            result.len(),
            expected_urls,
            result
        );

        // Specifically test that data URLs and CID URLs are excluded
        assert!(!result.contains(&"data:image/png;base64,iVBORw0KGgo".to_string()));
        assert!(!result.contains(&"cid:content-id-12345".to_string()));

        // Verify deduplication works
        let duplicate_count = result
            .iter()
            .filter(|url| url.contains("duplicate"))
            .count();
        assert_eq!(
            duplicate_count, 1,
            "Duplicate URLs were not properly deduplicated"
        );
    }

    #[test]
    fn test_extract_all_image_urls_with_no_images() {
        let html_content = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <h1>No images here</h1>
            <p>This HTML contains no images.</p>
        </body>
        </html>
        "#;

        let result = extract_all_image_urls(html_content).unwrap();
        assert!(
            result.is_empty(),
            "Expected empty set but found: {:?}",
            result
        );
    }

    #[test]
    fn test_extract_all_image_urls_with_malformed_srcset() {
        let html_content = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <!-- Malformed srcset with missing widths -->
            <img srcset="https://example.com/img1.jpg, https://example.com/img2.jpg" alt="Malformed srcset">

            <!-- Srcset with empty entries -->
            <img srcset="https://example.com/valid.jpg 400w, , https://example.com/also-valid.jpg 800w" alt="Srcset with empty parts">
        </body>
        </html>
        "#;

        let result = extract_all_image_urls(html_content).unwrap();

        let expected_urls: HashSet<String> = [
            "https://example.com/img1.jpg",
            "https://example.com/img2.jpg",
            "https://example.com/valid.jpg",
            "https://example.com/also-valid.jpg",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        assert_eq!(result, expected_urls);
    }

    #[test]
    fn test_extract_all_image_urls_with_different_url_formats() {
        let html_content = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <!-- Different URL formats -->
            <img src="https://example.com/path/to/image.jpg" alt="Standard URL">
            <img src="https://example.com/image.jpg?width=100&height=200" alt="URL with query parameters">
            <img src="https://sub.example.com/image.jpg" alt="Subdomain URL">
            <img src="https://example.com/image.jpg#fragment" alt="URL with fragment">

            <!-- Srcset with different formats -->
            <img srcset="https://example.com/image.jpg?size=small 400w,
                          https://example.com/image.jpg?size=large 800w" alt="Srcset with query params">
        </body>
        </html>
        "#;

        let result = extract_all_image_urls(html_content).unwrap();

        let expected_urls: HashSet<String> = [
            "https://example.com/path/to/image.jpg",
            "https://example.com/image.jpg?width=100&height=200",
            "https://sub.example.com/image.jpg",
            "https://example.com/image.jpg#fragment",
            "https://example.com/image.jpg?size=small",
            "https://example.com/image.jpg?size=large",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        assert_eq!(result, expected_urls);
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::collections::HashMap;

        #[test]
        fn test_rewrite_html_image_links_with_src_and_srcset() {
            // Create a mapping of original URLs to SFS URLs
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/image1.jpg".to_string(),
                "https://static-file-service.macro.com/f123/image1.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/small.jpg".to_string(),
                "https://static-file-service.macro.com/f124/small.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/medium.jpg".to_string(),
                "https://static-file-service.macro.com/f125/medium.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/large.jpg".to_string(),
                "https://static-file-service.macro.com/f126/large.jpg".to_string(),
            );
            url_map.insert(
                "https://picsum.photos/600/300".to_string(),
                "https://static-file-service.macro.com/f127/picsum600.jpg".to_string(),
            );
            url_map.insert(
                "https://picsum.photos/320/160".to_string(),
                "https://static-file-service.macro.com/f128/picsum320.jpg".to_string(),
            );
            url_map.insert(
                "https://picsum.photos/480/240".to_string(),
                "https://static-file-service.macro.com/f129/picsum480.jpg".to_string(),
            );

            // HTML with both src and srcset attributes
            let original_html = r#"<!DOCTYPE html>
<html>
<body>
    <h1>Test Email</h1>

    <!-- Simple image with src only -->
    <img src="https://example.com/image1.jpg" alt="Basic image">

    <!-- Image with srcset only -->
    <img srcset="https://example.com/small.jpg 320w,
                https://example.com/medium.jpg 800w,
                https://example.com/large.jpg 1200w"
         alt="Responsive image without src">

    <!-- Image with both src and srcset -->
    <img src="https://picsum.photos/600/300"
         srcset="https://picsum.photos/320/160 320w,
                 https://picsum.photos/480/240 480w,
                 https://picsum.photos/600/300 600w"
         alt="Photo from Lorem Picsum">

    <!-- Image with URL not in the map -->
    <img src="https://example.com/not-in-map.jpg" alt="Not in map">

    <!-- Image with mixed URLs in srcset (some in map, some not) -->
    <img srcset="https://example.com/small.jpg 320w,
                https://example.com/not-in-map-1.jpg 800w,
                https://example.com/large.jpg 1200w"
         alt="Mixed mapping">
</body>
</html>"#;

            // Call the function to test
            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Check for specific macro.com URLs in the result
            assert!(
                result.contains("src=\"https://static-file-service.macro.com/f123/image1.jpg\"")
            );
            assert!(
                result
                    .contains("srcset=\"https://static-file-service.macro.com/f124/small.jpg 320w")
            );
            assert!(result.contains("https://static-file-service.macro.com/f125/medium.jpg 800w"));
            assert!(
                result.contains("https://static-file-service.macro.com/f126/large.jpg 1200w\"")
            );
            assert!(
                result.contains("src=\"https://static-file-service.macro.com/f127/picsum600.jpg\"")
            );
            assert!(result.contains(
                "srcset=\"https://static-file-service.macro.com/f128/picsum320.jpg 320w"
            ));
            assert!(
                result.contains("https://static-file-service.macro.com/f129/picsum480.jpg 480w")
            );
            assert!(
                result.contains("https://static-file-service.macro.com/f127/picsum600.jpg 600w\"")
            );

            // URLs not in the map should remain unchanged
            assert!(result.contains("src=\"https://example.com/not-in-map.jpg\""));
            assert!(result.contains("https://example.com/not-in-map-1.jpg 800w"));
        }

        #[test]
        fn test_rewrite_html_image_links_with_complex_srcset() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/img-1x.jpg".to_string(),
                "https://static-file-service.macro.com/a1b2c3/img-1x.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/img-2x.jpg".to_string(),
                "https://static-file-service.macro.com/d4e5f6/img-2x.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/img-3x.jpg".to_string(),
                "https://static-file-service.macro.com/g7h8i9/img-3x.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/img-4x.jpg".to_string(),
                "https://static-file-service.macro.com/j0k1l2/img-4x.jpg".to_string(),
            );

            // Test with density descriptors and unusual formatting
            let original_html = r#"<!DOCTYPE html>
<html>
<body>
    <!-- Srcset with density descriptors -->
    <img src="https://example.com/img-1x.jpg"
         srcset="https://example.com/img-1x.jpg 1x,
                 https://example.com/img-2x.jpg 2x,
                 https://example.com/img-3x.jpg 3x"
         alt="Density descriptors">

    <!-- Srcset with unusual formatting -->
    <img srcset="  https://example.com/img-1x.jpg 1x  ,

                 https://example.com/img-2x.jpg    2x,

                 https://example.com/img-4x.jpg 4x  "
         alt="Unusual formatting">
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Check density descriptors are preserved with macro.com URLs
            assert!(
                result.contains(
                    "srcset=\"https://static-file-service.macro.com/a1b2c3/img-1x.jpg 1x"
                )
            );
            assert!(result.contains("https://static-file-service.macro.com/d4e5f6/img-2x.jpg 2x"));
            assert!(
                result.contains("https://static-file-service.macro.com/g7h8i9/img-3x.jpg 3x\"")
            );

            // Check unusual formatting is normalized but descriptors preserved
            assert!(
                result.contains(
                    "srcset=\"https://static-file-service.macro.com/a1b2c3/img-1x.jpg 1x, "
                )
            );
            assert!(
                result.contains("https://static-file-service.macro.com/d4e5f6/img-2x.jpg 2x, ")
            );
            assert!(
                result.contains("https://static-file-service.macro.com/j0k1l2/img-4x.jpg 4x\"")
            );
        }

        #[test]
        fn test_rewrite_html_image_links_with_multiple_img_tags() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/banner.jpg".to_string(),
                "https://static-file-service.macro.com/files/banner-12345.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/logo.png".to_string(),
                "https://static-file-service.macro.com/files/logo-67890.png".to_string(),
            );
            url_map.insert(
                "https://example.com/profile.jpg".to_string(),
                "https://static-file-service.macro.com/files/profile-abcde.jpg".to_string(),
            );

            // Test with multiple img tags in complex HTML structure
            let original_html = r#"<!DOCTYPE html>
<html>
<head>
    <title>Test Multiple Images</title>
</head>
<body>
    <header>
        <img src="https://example.com/logo.png" alt="Logo">
    </header>
    <main>
        <article>
            <h1>Article Title</h1>
            <img src="https://example.com/banner.jpg" alt="Banner">
            <p>Some text here...</p>
            <div class="profile">
                <img src="https://example.com/profile.jpg" alt="Profile">
                <p>Author name</p>
            </div>
        </article>
    </main>
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Check all images are rewritten with macro.com URLs
            assert!(
                result
                    .contains("src=\"https://static-file-service.macro.com/files/logo-67890.png\"")
            );
            assert!(
                result.contains(
                    "src=\"https://static-file-service.macro.com/files/banner-12345.jpg\""
                )
            );
            assert!(
                result.contains(
                    "src=\"https://static-file-service.macro.com/files/profile-abcde.jpg\""
                )
            );

            // Check HTML structure is preserved
            assert!(result.contains("<header>"));
            assert!(result.contains("<article>"));
            assert!(result.contains("<div class=\"profile\">"));
        }

        #[test]
        fn test_rewrite_html_image_links_with_no_matches() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/not-in-html.jpg".to_string(),
                "https://static-file-service.macro.com/not-in-html-uuid.jpg".to_string(),
            );

            // Test with no matching URLs
            let original_html = r#"<!DOCTYPE html>
<html>
<body>
    <img src="https://example.com/image1.jpg" alt="Image 1">
    <img src="https://example.com/image2.jpg" alt="Image 2"
         srcset="https://example.com/image2-small.jpg 320w,
                 https://example.com/image2-large.jpg 800w">
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Original HTML should be unchanged
            assert!(result.contains("src=\"https://example.com/image1.jpg\""));
            assert!(result.contains("src=\"https://example.com/image2.jpg\""));
            assert!(result.contains("srcset=\"https://example.com/image2-small.jpg 320w,"));
            assert!(result.contains("https://example.com/image2-large.jpg 800w\""));
        }

        #[test]
        fn test_rewrite_html_image_links_with_empty_map() {
            let url_map = HashMap::new();

            let original_html = r#"<!DOCTYPE html>
<html>
<body>
    <img src="https://example.com/image.jpg" alt="Image">
    <img srcset="https://example.com/image-small.jpg 320w,
                 https://example.com/image-large.jpg 800w" alt="Responsive">
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Original HTML should be unchanged
            assert_eq!(result, original_html);
        }

        #[test]
        fn test_rewrite_html_image_links_maintains_other_attributes() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/image.jpg".to_string(),
                "https://static-file-service.macro.com/cache/image-uuid123.jpg".to_string(),
            );

            // Test that other attributes are preserved
            let original_html = r#"<!DOCTYPE html>
<html>
<body>
    <img src="https://example.com/image.jpg"
         alt="Description"
         width="300"
         height="200"
         loading="lazy"
         class="responsive-image"
         id="hero-image"
         data-custom="value">
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Check URL is rewritten with macro.com URL
            assert!(
                result.contains(
                    "src=\"https://static-file-service.macro.com/cache/image-uuid123.jpg\""
                )
            );

            // Check other attributes are preserved
            assert!(result.contains("alt=\"Description\""));
            assert!(result.contains("width=\"300\""));
            assert!(result.contains("height=\"200\""));
            assert!(result.contains("loading=\"lazy\""));
            assert!(result.contains("class=\"responsive-image\""));
            assert!(result.contains("id=\"hero-image\""));
            assert!(result.contains("data-custom=\"value\""));
        }

        #[test]
        fn test_rewrite_html_image_links_with_whitespace_in_urls() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/image.jpg".to_string(),
                "https://static-file-service.macro.com/whitespace-test/image.jpg".to_string(),
            );

            // Test with whitespace in URLs
            let original_html = r#"<!DOCTYPE html>
<html>
<body>
    <img src="  https://example.com/image.jpg  " alt="Image with whitespace">
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Check URL is rewritten despite whitespace with macro.com URL
            assert!(result.contains(
                "src=\"https://static-file-service.macro.com/whitespace-test/image.jpg\""
            ));
        }

        #[test]
        fn test_rewrite_html_image_links_with_malformed_html() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/image.jpg".to_string(),
                "https://static-file-service.macro.com/malformed/image-abc123.jpg".to_string(),
            );

            // Test with malformed HTML
            let malformed_html = r#"<img src="https://example.com/image.jpg" alt="Unclosed tag"
<p>Missing closing tag
<div>Nested unclosed tags
<img src="https://example.com/image.jpg">"#;

            // The function should still work with malformed HTML
            let result = rewrite_html_image_links(malformed_html, &url_map).unwrap();

            // Check URL is still rewritten with macro.com URL
            assert!(result.contains(
                "src=\"https://static-file-service.macro.com/malformed/image-abc123.jpg\""
            ));
        }

        #[test]
        fn test_rewrite_html_image_links_with_html_entities() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/image.jpg".to_string(),
                "https://static-file-service.macro.com/entities-test/image-xyz789.jpg".to_string(),
            );

            // Test with HTML entities in the document
            let html_with_entities = r#"<!DOCTYPE html>
<html>
<body>
    <p>Text with &amp; entity and &quot;quotes&quot;</p>
    <img src="https://example.com/image.jpg" alt="Image with &amp; entity">
</body>
</html>"#;

            let result = rewrite_html_image_links(html_with_entities, &url_map).unwrap();

            // Check URL is rewritten with macro.com URL and entities are preserved
            assert!(result.contains(
                "src=\"https://static-file-service.macro.com/entities-test/image-xyz789.jpg\""
            ));
            assert!(result.contains("&amp; entity"));
            assert!(result.contains("&quot;quotes&quot;"));
        }

        #[test]
        fn test_rewrite_html_image_links_with_multiple_srcset_attributes() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/image-1.jpg".to_string(),
                "https://static-file-service.macro.com/multi-srcset/image-1-uuid456.jpg"
                    .to_string(),
            );
            url_map.insert(
                "https://example.com/image-2.jpg".to_string(),
                "https://static-file-service.macro.com/multi-srcset/image-2-uuid789.jpg"
                    .to_string(),
            );

            // Multiple img tags with srcset
            let original_html = r#"<!DOCTYPE html>
<html>
<body>
    <img srcset="https://example.com/image-1.jpg 1x" alt="First image">
    <img srcset="https://example.com/image-2.jpg 1x" alt="Second image">
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Check both srcsets are rewritten with macro.com URLs
            assert!(result.contains("srcset=\"https://static-file-service.macro.com/multi-srcset/image-1-uuid456.jpg 1x\""));
            assert!(result.contains("srcset=\"https://static-file-service.macro.com/multi-srcset/image-2-uuid789.jpg 1x\""));
        }

        #[test]
        fn test_rewrite_html_image_links_with_realistic_email_template() {
            let mut url_map = HashMap::new();
            url_map.insert(
                "https://example.com/header-logo.png".to_string(),
                "https://static-file-service.macro.com/email/header-logo-e7d9f2.png".to_string(),
            );
            url_map.insert(
                "https://example.com/hero-small.jpg".to_string(),
                "https://static-file-service.macro.com/email/hero-small-a1b2c3.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/hero-medium.jpg".to_string(),
                "https://static-file-service.macro.com/email/hero-medium-d4e5f6.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/hero-large.jpg".to_string(),
                "https://static-file-service.macro.com/email/hero-large-g7h8i9.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/product-1.jpg".to_string(),
                "https://static-file-service.macro.com/email/product-1-j0k1l2.jpg".to_string(),
            );
            url_map.insert(
                "https://example.com/footer-logo.png".to_string(),
                "https://static-file-service.macro.com/email/footer-logo-m3n4p5.png".to_string(),
            );

            // Realistic email template with multiple images
            let original_html = r#"<!DOCTYPE html>
<html>
<head>
    <title>Monthly Newsletter</title>
</head>
<body>
    <div class="header">
        <img src="https://example.com/header-logo.png" alt="Company Logo">
        <h1>Monthly Newsletter</h1>
    </div>

    <div class="hero">
        <img src="https://example.com/hero-medium.jpg"
             srcset="https://example.com/hero-small.jpg 320w,
                     https://example.com/hero-medium.jpg 600w,
                     https://example.com/hero-large.jpg 1200w"
             sizes="(max-width: 600px) 100vw, 600px"
             alt="Hero Image">
    </div>

    <div class="content">
        <h2>Featured Product</h2>
        <img src="https://example.com/product-1.jpg" alt="Product 1">
        <p>Check out our latest product!</p>
    </div>

    <div class="footer">
        <img src="https://example.com/footer-logo.png" alt="Footer Logo">
        <p>&copy; 2023 Company Name</p>
    </div>
</body>
</html>"#;

            let result = rewrite_html_image_links(original_html, &url_map).unwrap();

            // Check all URLs are replaced with macro.com URLs
            assert!(result.contains(
                "src=\"https://static-file-service.macro.com/email/header-logo-e7d9f2.png\""
            ));
            assert!(result.contains(
                "src=\"https://static-file-service.macro.com/email/hero-medium-d4e5f6.jpg\""
            ));
            assert!(result.contains(
                "srcset=\"https://static-file-service.macro.com/email/hero-small-a1b2c3.jpg 320w,"
            ));
            assert!(result.contains(
                "https://static-file-service.macro.com/email/hero-medium-d4e5f6.jpg 600w,"
            ));
            assert!(result.contains(
                "https://static-file-service.macro.com/email/hero-large-g7h8i9.jpg 1200w\""
            ));
            assert!(result.contains(
                "src=\"https://static-file-service.macro.com/email/product-1-j0k1l2.jpg\""
            ));
            assert!(result.contains(
                "src=\"https://static-file-service.macro.com/email/footer-logo-m3n4p5.png\""
            ));
        }
    }
}
