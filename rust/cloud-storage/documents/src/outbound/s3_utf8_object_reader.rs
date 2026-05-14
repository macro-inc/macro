//! Shared S3 UTF-8 object reader adapter.

/// Error while reading an S3 object as UTF-8 text.
#[derive(Clone, Debug, thiserror::Error)]
pub enum S3Utf8ObjectReadError {
    /// The object does not exist at the requested key.
    #[error("object missing")]
    Missing,
    /// The object read failed for a reason other than missing key.
    #[error("failed to read object: {0}")]
    Read(String),
    /// The object bytes were not valid UTF-8.
    #[error("object is not valid UTF-8: {0}")]
    InvalidUtf8(String),
}

/// S3-backed UTF-8 object reader.
#[derive(Clone)]
pub struct S3Utf8ObjectReader {
    s3_client: aws_sdk_s3::Client,
}

impl S3Utf8ObjectReader {
    /// Construct an S3 UTF-8 object reader.
    pub fn new(s3_client: aws_sdk_s3::Client) -> Self {
        Self { s3_client }
    }

    /// Read an S3 object body as UTF-8 text.
    #[tracing::instrument(err, skip(self))]
    pub async fn read_utf8(
        &self,
        bucket: &str,
        key: &str,
    ) -> Result<String, S3Utf8ObjectReadError> {
        let response = self
            .s3_client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| {
                if is_no_such_key_error(&error) {
                    S3Utf8ObjectReadError::Missing
                } else {
                    S3Utf8ObjectReadError::Read(format!("{error:?}"))
                }
            })?;

        let bytes = response
            .body
            .collect()
            .await
            .map_err(|error| S3Utf8ObjectReadError::Read(format!("{error:?}")))?
            .into_bytes();

        String::from_utf8(bytes.to_vec())
            .map_err(|error| S3Utf8ObjectReadError::InvalidUtf8(error.to_string()))
    }
}

fn is_no_such_key_error(
    error: &aws_sdk_s3::error::SdkError<aws_sdk_s3::operation::get_object::GetObjectError>,
) -> bool {
    error
        .as_service_error()
        .is_some_and(|error| error.is_no_such_key())
}
