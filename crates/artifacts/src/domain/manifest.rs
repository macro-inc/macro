//! Validation of a published file bundle into a [`Manifest`].
//!
//! Parsing checks everything the request itself says: paths, content types,
//! digests of inline bytes and scenes. Sizes of files sent without bytes come
//! from storage, so the size limits are checked when the draft is finished.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap, HashSet};

use lazy_regex::regex_is_match;
use sha2::Digest;

use super::models::{
    ALLOWED_CONTENT_TYPES, ArtifactError, ArtifactPath, ENTRY_PATH, FileInput, MAX_FILE_BYTES,
    MAX_FILES, MAX_PATH_CHARS, MAX_VERSION_BYTES, Manifest, Scene, SceneId, SceneInput, Sha256,
    StoredFile,
};

/// Parse a file path.
pub fn parse_path(raw: &str) -> Result<ArtifactPath, ArtifactError> {
    let invalid =
        |reason: &str| ArtifactError::BadRequest(format!("invalid path {raw:?}: {reason}"));

    if raw.is_empty() {
        return Err(invalid("empty"));
    }
    if raw.chars().count() > MAX_PATH_CHARS {
        return Err(invalid("longer than 512 characters"));
    }
    if raw.starts_with('/') {
        return Err(invalid("must be relative"));
    }
    if raw.contains('\\') || raw.chars().any(char::is_control) {
        return Err(invalid("contains a backslash or control character"));
    }

    for segment in raw.split('/') {
        if segment.is_empty() {
            return Err(invalid("empty segment"));
        }
        if segment == "." || segment == ".." {
            return Err(invalid("dot segment"));
        }
    }

    Ok(ArtifactPath(raw.to_string()))
}

/// Parse a hex SHA-256 digest, accepting either case.
pub fn parse_sha256(raw: &str) -> Result<Sha256, ArtifactError> {
    let digest = raw.to_ascii_lowercase();
    if !regex_is_match!(r"^[0-9a-f]{64}$", &digest) {
        return Err(ArtifactError::BadRequest(format!(
            "invalid sha256 {raw:?}: expected 64 hex characters"
        )));
    }
    Ok(Sha256(digest))
}

/// Parse a content type from the allowlist.
pub fn parse_content_type(raw: &str) -> Result<String, ArtifactError> {
    let content_type = raw.trim().to_ascii_lowercase();
    if !ALLOWED_CONTENT_TYPES.contains(&content_type.as_str()) {
        return Err(ArtifactError::BadRequest(format!(
            "content type {raw:?} is not allowed"
        )));
    }
    Ok(content_type)
}

/// Parse a scene id slug.
pub fn parse_scene_id(raw: &str) -> Result<SceneId, ArtifactError> {
    if !regex_is_match!(r"^[a-z0-9][a-z0-9-]{0,63}$", raw) {
        return Err(ArtifactError::BadRequest(format!(
            "invalid scene id {raw:?}: expected a slug of lowercase letters, digits and dashes"
        )));
    }
    Ok(SceneId(raw.to_string()))
}

/// Hex SHA-256 of bytes.
pub fn sha256_of(bytes: &[u8]) -> Sha256 {
    Sha256(hex::encode(sha2::Sha256::digest(bytes)))
}

/// A parsed file whose size may still come from storage.
#[derive(Debug, Clone)]
pub struct DraftFile {
    /// Path inside the version.
    pub path: ArtifactPath,
    /// The object's digest.
    pub sha256: Sha256,
    /// Declared content type.
    pub content_type: String,
    /// Inline bytes, already checked against the digest.
    pub content: Option<Vec<u8>>,
}

/// An object whose bytes came with the request and must be stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineObject {
    /// The object's digest.
    pub sha256: Sha256,
    /// Declared content type of the first file carrying it.
    pub content_type: String,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// A parsed bundle, before sizes of stored files are known.
#[derive(Debug, Clone)]
pub struct ManifestDraft {
    files: Vec<DraftFile>,
    scenes: Vec<Scene>,
}

impl ManifestDraft {
    /// Parse and check a bundle as sent.
    pub fn parse(files: Vec<FileInput>, scenes: Vec<SceneInput>) -> Result<Self, ArtifactError> {
        if files.len() > MAX_FILES {
            return Err(ArtifactError::BadRequest(format!(
                "a version holds at most {MAX_FILES} files"
            )));
        }

        let mut seen_paths = HashSet::new();
        let mut draft_files = Vec::with_capacity(files.len());
        for file in files {
            let path = parse_path(&file.path)?;
            if !seen_paths.insert(path.clone()) {
                return Err(ArtifactError::BadRequest(format!(
                    "path {:?} appears twice",
                    file.path
                )));
            }

            let content_type = parse_content_type(&file.content_type)?;
            let sha256 = parse_sha256(&file.sha256)?;

            if let Some(content) = &file.content {
                if content.len() as u64 > MAX_FILE_BYTES {
                    return Err(ArtifactError::BadRequest(format!(
                        "{:?} is larger than 16 MiB",
                        file.path
                    )));
                }
                if sha256_of(content) != sha256 {
                    return Err(ArtifactError::BadRequest(format!(
                        "sha256 of {:?} does not match its content",
                        file.path
                    )));
                }
            }

            draft_files.push(DraftFile {
                path,
                sha256,
                content_type,
                content: file.content,
            });
        }

        if !draft_files
            .iter()
            .any(|file| file.path.as_str() == ENTRY_PATH)
        {
            return Err(ArtifactError::BadRequest(format!(
                "a version must include {ENTRY_PATH}"
            )));
        }

        let mut seen_scene_ids = HashSet::new();
        let mut parsed_scenes = Vec::with_capacity(scenes.len());
        for scene in scenes {
            let id = parse_scene_id(&scene.id)?;
            if !seen_scene_ids.insert(id.clone()) {
                return Err(ArtifactError::BadRequest(format!(
                    "scene id {:?} appears twice",
                    scene.id
                )));
            }

            let title = scene.title.trim().to_string();
            if title.is_empty() {
                return Err(ArtifactError::BadRequest(format!(
                    "scene {:?} needs a title",
                    scene.id
                )));
            }

            let path = parse_path(&scene.path)?;
            if !seen_paths.contains(&path) {
                return Err(ArtifactError::BadRequest(format!(
                    "scene {:?} points at {:?}, which is not one of the files",
                    scene.id, scene.path
                )));
            }

            parsed_scenes.push(Scene { id, title, path });
        }

        Ok(Self {
            files: draft_files,
            scenes: parsed_scenes,
        })
    }

    /// Files as parsed.
    pub fn files(&self) -> &[DraftFile] {
        &self.files
    }

    /// Digests of files sent without bytes, whose sizes come from storage.
    pub fn stored_digests(&self) -> HashSet<Sha256> {
        self.files
            .iter()
            .filter(|file| file.content.is_none())
            .map(|file| file.sha256.clone())
            .collect()
    }

    /// Finish the manifest with the sizes of objects already stored for the
    /// artifact, checking the size limits. Returns the manifest and the
    /// inline objects to store, one per digest.
    pub fn finish(
        self,
        stored_sizes: &HashMap<Sha256, u64>,
    ) -> Result<(Manifest, Vec<InlineObject>), ArtifactError> {
        let mut files = BTreeMap::new();
        let mut inline_objects: Vec<InlineObject> = Vec::new();
        let mut total: u64 = 0;

        for file in self.files {
            let size = match &file.content {
                Some(content) => content.len() as u64,
                None => *stored_sizes.get(&file.sha256).ok_or_else(|| {
                    ArtifactError::BadRequest(format!(
                        "{:?} has no content and {} is not stored for this artifact",
                        file.path.as_str(),
                        file.sha256.as_str()
                    ))
                })?,
            };

            if size > MAX_FILE_BYTES {
                return Err(ArtifactError::BadRequest(format!(
                    "{:?} is larger than 16 MiB",
                    file.path.as_str()
                )));
            }
            total += size;

            if let Some(bytes) = file.content
                && !inline_objects
                    .iter()
                    .any(|object| object.sha256 == file.sha256)
            {
                inline_objects.push(InlineObject {
                    sha256: file.sha256.clone(),
                    content_type: file.content_type.clone(),
                    bytes,
                });
            }

            files.insert(
                file.path,
                StoredFile {
                    sha256: file.sha256,
                    size,
                    content_type: file.content_type,
                },
            );
        }

        if total > MAX_VERSION_BYTES {
            return Err(ArtifactError::BadRequest(
                "a version holds at most 64 MiB".to_string(),
            ));
        }

        Ok((
            Manifest {
                files,
                scenes: self.scenes,
            },
            inline_objects,
        ))
    }
}
