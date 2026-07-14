#[cfg(test)]
mod test;

use serde::{Deserialize, Serialize};

/// Incoming request from a Lambda Function URL (forwarded by CloudFront).
#[derive(Deserialize)]
pub struct FunctionUrlRequest {
    /// Parsed from the CF-rewritten `rawPath`, e.g. `/file/{uuid}/format=avif,size=1080`.
    #[serde(rename = "rawPath", default, deserialize_with = "deserialize_path")]
    pub path: FilePath,
}

/// File path parsed from the CloudFront-rewritten URI.
#[derive(Default)]
pub struct FilePath {
    /// The file ID (UUID) extracted from the path.
    pub file_id: Option<String>,
    /// The transform suffix (e.g. `format=avif,size=1080`), set by the CF URL rewrite function.
    pub transform_suffix: Option<String>,
}

fn deserialize_path<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<FilePath, D::Error> {
    let raw = String::deserialize(deserializer)?;

    let Some(after_prefix) = raw
        .trim_start_matches('/')
        .strip_prefix("file/")
        .filter(|s| !s.is_empty())
    else {
        return Ok(FilePath::default());
    };

    Ok(match after_prefix.split_once('/') {
        None => FilePath {
            file_id: Some(after_prefix.to_string()),
            transform_suffix: None,
        },
        Some((id, suffix)) if !id.is_empty() && !suffix.is_empty() => FilePath {
            file_id: Some(id.to_string()),
            transform_suffix: Some(suffix.to_string()),
        },
        _ => FilePath::default(),
    })
}

/// Payload for an async (self-invoked) resize job.
#[derive(Debug, Deserialize, Serialize)]
pub struct AsyncResizeRequest {
    /// S3 key of the original file, e.g. `file/{uuid}`.
    pub original_key: String,
    /// S3 key where the transformed result will be stored.
    pub transformed_s3_key: String,
    /// Target size in pixels (longest edge).
    pub size: u32,
}

/// Top-level Lambda event — either a CloudFront-originated request or an async resize job.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum LambdaRequest {
    /// Self-invoked async resize (tried first because it has required fields that disambiguate).
    AsyncResize(AsyncResizeRequest),
    /// CloudFront Function URL request.
    FunctionUrl(FunctionUrlRequest),
}
