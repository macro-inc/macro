//! Package-level helpers for edits: adding images, copying part trees,
//! pruning unused relationships, and deleting parts nothing references.

use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::opc::{
    Relationship, Relationships, TargetMode, rel_type, relative_target, rels_part_name,
};
use crate::xml::Ns;
use std::collections::{HashMap, HashSet, VecDeque};

/// Largest picture accepted from an edit (decoded pixels).
const MAX_IMAGE_PIXELS: u64 = 100_000_000;

/// An image part referenced from a slide.
pub struct AddedImage {
    /// Relationship id from the slide.
    pub rid: String,
    /// Pixel width.
    pub width: u32,
    /// Pixel height.
    pub height: u32,
}

/// Decodes base64 (optionally a `data:` URL) into bytes.
pub fn decode_base64(data: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    let payload = data.trim();
    let payload = match payload.find("base64,") {
        Some(i) if payload.starts_with("data:") => &payload[i + "base64,".len()..],
        _ => payload,
    };
    let cleaned: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
    base64::engine::general_purpose::STANDARD
        .decode(cleaned.as_bytes())
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(cleaned.as_bytes()))
        .or_else(|_| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(cleaned.trim_end_matches('=').as_bytes())
        })
        .map_err(|e| Error::InvalidEdit(format!("image data is not valid base64: {e}")))
}

/// File extension and content type of a supported picture format.
fn sniff(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpeg", "image/jpeg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("gif", "image/gif"))
    } else {
        None
    }
}

/// Pixel dimensions from an image header.
pub fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let be32 = |b: &[u8]| u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
    match sniff(bytes)?.0 {
        "png" if bytes.len() >= 24 => Some((be32(&bytes[16..20]), be32(&bytes[20..24]))),
        "gif" if bytes.len() >= 10 => Some((
            u32::from(u16::from_le_bytes([bytes[6], bytes[7]])),
            u32::from(u16::from_le_bytes([bytes[8], bytes[9]])),
        )),
        "jpeg" => {
            let mut i = 2;
            while i + 9 < bytes.len() {
                if bytes[i] != 0xFF {
                    i += 1;
                    continue;
                }
                let marker = bytes[i + 1];
                if marker == 0xFF {
                    i += 1;
                    continue;
                }
                let len = usize::from(u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]));
                // Start-of-frame markers (excluding DHT, JPG, DAC).
                if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
                    let h = u32::from(u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]));
                    let w = u32::from(u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]));
                    return Some((w, h));
                }
                i += 2 + len;
            }
            None
        }
        _ => None,
    }
}

/// Stores a picture (reusing an identical media part) and relates it to `source_part`.
pub fn add_image(pres: &mut Presentation, source_part: &str, bytes: &[u8]) -> Result<AddedImage> {
    let (ext, content_type) = sniff(bytes).ok_or_else(|| {
        Error::InvalidEdit("unsupported image format (use PNG, JPEG, or GIF)".into())
    })?;
    let (width, height) =
        image_size(bytes).ok_or_else(|| Error::InvalidEdit("image header is corrupt".into()))?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(Error::InvalidEdit(format!(
            "image size {width}x{height} is not supported"
        )));
    }
    let existing = pres
        .pkg
        .part_names()
        .filter(|n| n.starts_with("/ppt/media/"))
        .filter(|n| pres.pkg.part_size(n) == Some(bytes.len() as u64))
        .find(|n| pres.pkg.read(n).is_ok_and(|b| *b == *bytes))
        .map(str::to_owned);
    let part = match existing {
        Some(p) => p,
        None => {
            let name = pres
                .pkg
                .unique_part_name("/ppt/media/image", &format!(".{ext}"));
            pres.pkg.write(&name, bytes.to_vec(), None);
            if pres.pkg.content_type(&name) != Some(content_type) {
                pres.pkg
                    .content_types_mut()
                    .set_override(&name, content_type);
            }
            pres.pkg
                .content_types_mut()
                .ensure_default(ext, content_type);
            name
        }
    };
    let rels = pres.rels_mut(source_part)?;
    let existing_rel = rels
        .iter()
        .find(|r| {
            r.rel_type == rel_type::IMAGE
                && r.mode == TargetMode::Internal
                && rels.resolve(r) == part
        })
        .map(|r| r.id.clone());
    let rid = match existing_rel {
        Some(id) => id,
        None => rels.add_internal(rel_type::IMAGE, &part),
    };
    Ok(AddedImage { rid, width, height })
}

/// A fresh part name in the same folder, numbered like the original
/// (`/ppt/charts/chart3.xml` → `/ppt/charts/chart7.xml`).
pub fn sibling_name(pres: &Presentation, part: &str) -> String {
    let (stem, ext) = match part.rsplit_once('.') {
        Some((s, e)) if !s.ends_with('/') => (s, format!(".{e}")),
        _ => (part, String::new()),
    };
    let prefix = stem.trim_end_matches(|c: char| c.is_ascii_digit());
    pres.pkg.unique_part_name(prefix, &ext)
}

/// Relationship types whose targets a copied part shares instead of copying.
fn shares_target(rel_type: &str) -> bool {
    const SHARED: &[&str] = &[
        "/slideLayout",
        "/slideMaster",
        "/notesMaster",
        "/handoutMaster",
        "/theme",
        "/image",
        "/media",
        "/video",
        "/audio",
        "/slide",
        "/presentation",
        "/hyperlink",
        "/font",
    ];
    SHARED.iter().any(|s| rel_type.ends_with(s))
}

/// Relationship types dropped from copies (one-per-source parts that make no sense duplicated).
fn dropped_on_copy(rel_type: &str) -> bool {
    rel_type.ends_with("/comments") || rel_type.ends_with("/commentAuthors")
}

/// Copies `part` (and the parts it owns, recursively) under fresh names.
///
/// `renamed` maps original part names to their copies; targets found in it
/// are redirected, so a notes slide copied with its slide points back at the
/// new slide.
pub fn copy_part_tree(
    pres: &mut Presentation,
    part: &str,
    renamed: &mut HashMap<String, String>,
) -> Result<String> {
    if let Some(done) = renamed.get(part) {
        return Ok(done.clone());
    }
    let new = sibling_name(pres, part);
    renamed.insert(part.to_owned(), new.clone());
    // Edits earlier in the batch may not be written back to the package yet.
    let bytes = match pres.xml.get(part).filter(|_| pres.dirty_xml.contains(part)) {
        Some(doc) => doc.to_bytes(),
        None => pres.pkg.read(part)?.into_owned(),
    };
    let content_type = pres.pkg.content_type(part).map(str::to_owned);
    let ext = new.rsplit_once('.').map_or("", |(_, e)| e);
    let needs_override = content_type
        .as_deref()
        .is_some_and(|ct| pres.pkg.content_types().default_for(ext) != Some(ct));
    pres.pkg.write(
        &new,
        bytes,
        if needs_override {
            content_type.as_deref()
        } else {
            None
        },
    );

    let source_rels = pres.part_rels(part)?;
    let mut rels = Relationships::empty(&new);
    for r in source_rels.iter() {
        if dropped_on_copy(&r.rel_type) {
            continue;
        }
        if r.mode == TargetMode::External {
            rels.push(r.clone());
            continue;
        }
        let target = source_rels.resolve(r);
        if !pres.pkg.has_part(&target) {
            // Dangling internal targets are dropped rather than copied.
            continue;
        }
        let target = pres
            .pkg
            .canonical_name(&target)
            .unwrap_or(&target)
            .to_owned();
        let new_target = if let Some(mapped) = renamed.get(&target) {
            mapped.clone()
        } else if shares_target(&r.rel_type) {
            target
        } else {
            copy_part_tree(pres, &target, renamed)?
        };
        rels.push(Relationship {
            id: r.id.clone(),
            rel_type: r.rel_type.clone(),
            target: relative_target(&new, &new_target),
            mode: TargetMode::Internal,
        });
    }
    if rels.iter().next().is_some() {
        pres.put_rels(rels);
    }
    Ok(new)
}

/// Every part reachable from the package root through relationships.
pub fn reachable(pres: &mut Presentation) -> Result<HashSet<String>> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::from(["/".to_owned()]);
    while let Some(part) = queue.pop_front() {
        let rels = pres.part_rels(&part)?;
        for r in rels.iter().filter(|r| r.mode == TargetMode::Internal) {
            let target = rels.resolve(r);
            let Some(canonical) = pres.pkg.canonical_name(&target).map(str::to_owned) else {
                continue;
            };
            if seen.insert(canonical.clone()) {
                queue.push_back(canonical);
            }
        }
    }
    Ok(seen)
}

/// The state needed to find parts an edit batch orphaned.
pub struct GcBaseline {
    reachable: HashSet<String>,
    existing: HashSet<String>,
}

/// Records which parts exist and are reachable before a batch.
pub fn baseline(pres: &mut Presentation) -> Result<GcBaseline> {
    Ok(GcBaseline {
        reachable: reachable(pres)?,
        existing: pres.pkg.part_names().map(str::to_owned).collect(),
    })
}

/// Deletes parts that became unreachable during the batch (or were created
/// by it and are no longer used).
pub fn collect_garbage(pres: &mut Presentation, before: &GcBaseline) -> Result<()> {
    // Relationship edits must be visible to the reachability walk.
    let now = reachable(pres)?;
    let doomed: Vec<String> = pres
        .pkg
        .part_names()
        .filter(|n| !now.contains(*n))
        .filter(|n| {
            !n.ends_with(".rels") && !n.eq_ignore_ascii_case(crate::opc::CONTENT_TYPES_PART)
        })
        .filter(|n| before.reachable.contains(*n) || !before.existing.contains(*n))
        .map(str::to_owned)
        .collect();
    for part in doomed {
        pres.pkg.delete(&part);
        pres.pkg.delete(&rels_part_name(&part));
        pres.forget(&part);
    }
    Ok(())
}

/// Relationship types that only exist to serve explicit `r:` references in a slide.
fn prunable(rel_type: &str) -> bool {
    const PRUNABLE: &[&str] = &[
        "/image",
        "/chart",
        "/hyperlink",
        "/oleObject",
        "/package",
        "/video",
        "/audio",
        "/media",
        "/diagramData",
        "/diagramLayout",
        "/diagramQuickStyle",
        "/diagramColors",
        "/slide",
    ];
    PRUNABLE.iter().any(|s| rel_type.ends_with(s))
}

/// Removes relationships of edited slides that no markup references any more.
pub fn prune_rels(pres: &mut Presentation) -> Result<()> {
    let edited: Vec<String> = pres.dirty_xml.iter().cloned().collect();
    for part in edited {
        let doc = pres.xml(&part)?;
        if !doc.is(doc.root(), Ns::P, "sld") {
            continue;
        }
        let mut used: HashSet<String> = HashSet::new();
        let mut has_diagram = false;
        for n in doc.descendants(doc.root()) {
            if doc.local(n) == "relIds" {
                has_diagram = true;
            }
            for a in doc.attrs(n) {
                if a.ns() == Ns::R {
                    used.insert(a.value().to_owned());
                }
            }
        }
        let rels = pres.part_rels(&part)?;
        let unused: Vec<String> = rels
            .iter()
            .filter(|r| {
                let orphan_drawing = r.rel_type == rel_type::DIAGRAM_DRAWING && !has_diagram;
                (prunable(&r.rel_type) || orphan_drawing) && !used.contains(&r.id)
            })
            .map(|r| r.id.clone())
            .collect();
        if unused.is_empty() {
            continue;
        }
        let rels = pres.rels_mut(&part)?;
        for id in unused {
            rels.remove(&id);
        }
    }
    Ok(())
}
