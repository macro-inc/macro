//! Keys of artifact objects, content-addressed per artifact document.

#[cfg(test)]
mod test;

/// Every artifact's objects live under this prefix.
const ARTIFACT_PREFIX: &str = "artifacts";

/// The prefix holding every object of one artifact, with its trailing `/` so
/// it never matches another document id it is a prefix of.
pub fn build_artifact_document_prefix(document_id: &str) -> String {
    format!("{ARTIFACT_PREFIX}/{document_id}/")
}

/// The key of one artifact object: `artifacts/<document_id>/<sha256>`.
pub fn build_artifact_object_key(document_id: &str, sha256: &str) -> String {
    format!("{}{sha256}", build_artifact_document_prefix(document_id))
}
