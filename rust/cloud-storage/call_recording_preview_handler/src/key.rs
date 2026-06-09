#[cfg(test)]
mod test;

use anyhow::Context;

const CALLS_PREFIX: &str = "calls/";
const MP4_SUFFIX: &str = ".mp4";
const PREVIEW_FILENAME: &str = "PREVIEW.jpg";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreviewKeys {
    pub source_key: String,
    pub recording_key: String,
    pub preview_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum KeyDecision {
    Process(PreviewKeys),
    Skip(SkipReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SkipReason {
    MissingCallsPrefix,
    MissingParent,
    PreviewImage,
    NonMp4,
}

impl SkipReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MissingCallsPrefix => "object key is outside calls/",
            Self::MissingParent => "object key has no call recording parent",
            Self::PreviewImage => "object key is the generated preview image",
            Self::NonMp4 => "object key is not an mp4 recording",
        }
    }
}

pub(crate) fn preview_keys_from_encoded_s3_key(encoded_key: &str) -> anyhow::Result<KeyDecision> {
    let decoded_key = decode_s3_object_key(encoded_key)?;
    Ok(preview_keys_from_decoded_s3_key(&decoded_key))
}

pub(crate) fn decode_s3_object_key(encoded_key: &str) -> anyhow::Result<String> {
    let form_encoded_key = encoded_key.replace('+', "%20");
    let decoded = urlencoding::decode(&form_encoded_key)
        .with_context(|| format!("failed to decode S3 object key {encoded_key}"))?;

    Ok(decoded.into_owned())
}

pub(crate) fn preview_keys_from_decoded_s3_key(decoded_key: &str) -> KeyDecision {
    let Some(recording_key) = decoded_key.strip_prefix(CALLS_PREFIX) else {
        return KeyDecision::Skip(SkipReason::MissingCallsPrefix);
    };

    let Some((parent, file_name)) = recording_key.rsplit_once('/') else {
        return KeyDecision::Skip(SkipReason::MissingParent);
    };

    if parent.is_empty() || file_name.is_empty() {
        return KeyDecision::Skip(SkipReason::MissingParent);
    }

    if file_name == PREVIEW_FILENAME {
        return KeyDecision::Skip(SkipReason::PreviewImage);
    }

    if !file_name.ends_with(MP4_SUFFIX) {
        return KeyDecision::Skip(SkipReason::NonMp4);
    }

    let Some(recording_stem) = file_name.strip_suffix(MP4_SUFFIX) else {
        return KeyDecision::Skip(SkipReason::NonMp4);
    };

    KeyDecision::Process(PreviewKeys {
        source_key: decoded_key.to_string(),
        recording_key: recording_key.to_string(),
        preview_key: format!("{CALLS_PREFIX}{parent}/{recording_stem}/{PREVIEW_FILENAME}"),
    })
}
