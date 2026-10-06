//! Video and audio on slides: what a media shape plays, and its bytes.

use crate::error::{Error, Result};
use crate::model::presentation::{PartRef, Presentation};
use crate::opc::TargetMode;
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::Serialize;

/// The clip a video or audio shape plays.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOutline {
    /// `video` or `audio`.
    pub kind: &'static str,
    /// The embedded media part (read with `Presentation::media_bytes`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    /// The address of a linked (not embedded) clip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// The clip of picture `node` of `part`, when it is a video or audio shape.
pub(super) fn media_outline(doc: &XmlDoc, part: &PartRef, node: NodeId) -> Option<MediaOutline> {
    let nv_pr = doc
        .children(node)
        .find(|&c| doc.local(c) == "nvPicPr")
        .and_then(|n| doc.child(n, Ns::P, "nvPr"))?;
    let (kind, file) = doc.children(nv_pr).find_map(|c| match doc.local(c) {
        "videoFile" | "quickTimeFile" => Some(("video", c)),
        "audioFile" | "wavAudioFile" => Some(("audio", c)),
        _ => None,
    })?;
    let embedded = doc
        .descendants(nv_pr)
        .into_iter()
        .find(|&n| doc.local(n) == "media")
        .and_then(|m| doc.attr_ns(m, Ns::R, "embed"))
        .and_then(|id| part.rels.target_part(id));
    let linked = doc
        .attr_ns(file, Ns::R, "link")
        .or_else(|| doc.attr_ns(file, Ns::R, "embed"))
        .and_then(|id| part.rels.get(id));
    let (linked_part, url) = match linked {
        Some(r) if r.mode == TargetMode::External => (None, Some(r.target.clone())),
        Some(r) => (Some(part.rels.resolve(r)), None),
        None => (None, None),
    };
    Some(MediaOutline {
        kind,
        part: embedded.or(linked_part),
        url,
    })
}

impl Presentation {
    /// The bytes of a media part (`MediaOutline::part`).
    pub fn media_bytes(&self, part: &str) -> Result<Vec<u8>> {
        if !part.starts_with("/ppt/media/") || !self.pkg.has_part(part) {
            return Err(Error::NotFound(format!("media {part}")));
        }
        Ok(self.pkg.read(part)?.into_owned())
    }
}

#[cfg(test)]
mod test;
