//! Test support: the tagged blocks of the `.psd` and `.psb` files under the
//! directory `PSD_CORPUS_DIR` names, for checks against real files (the
//! `#[ignore]` corpus tests; nothing runs when the variable is unset).
//!
//! The split is deliberately minimal (header, image resources, layer
//! records, document-level blocks) and independent of `crate::file`.

use crate::binary::Reader;
use crate::codec::descriptor;
use std::path::{Path, PathBuf};

/// Keys whose lengths are 64-bit in large documents.
const LONG_KEYS: [&[u8; 4]; 19] = [
    b"LMsk", b"Lr16", b"Lr32", b"Layr", b"Mt16", b"Mt32", b"Mtrn", b"Alph", b"FMsk", b"lnk2",
    b"lnk3", b"lnkE", b"FEid", b"FXid", b"PxSD", b"cinf", b"pths", b"extd", b"extn",
];

/// A layer record's name and blocks.
pub struct Layer {
    /// The Pascal name (MacRoman, shown as Latin-1).
    pub name: String,
    /// The `luni` name when there is one.
    pub unicode_name: Option<String>,
    /// Tagged blocks, in file order (data as the length counts it).
    pub blocks: Vec<([u8; 4], Vec<u8>)>,
}

impl Layer {
    /// The first block with a key.
    pub fn block(&self, key: &[u8; 4]) -> Option<&[u8]> {
        self.blocks
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, d)| d.as_slice())
    }

    /// The best name: `luni`, else the Pascal name.
    pub fn display_name(&self) -> &str {
        self.unicode_name.as_deref().unwrap_or(&self.name)
    }
}

/// A file's parts.
pub struct File {
    /// Where it is.
    pub path: PathBuf,
    /// Canvas width.
    pub width: u32,
    /// Canvas height.
    pub height: u32,
    /// A large document.
    pub psb: bool,
    /// Image resources: id and data.
    pub resources: Vec<(u16, Vec<u8>)>,
    /// Layers, bottom first.
    pub layers: Vec<Layer>,
    /// Document-level blocks.
    pub globals: Vec<([u8; 4], Vec<u8>)>,
}

impl File {
    /// The path relative to the corpus directory, for messages.
    pub fn label(&self) -> String {
        let root = corpus_dir().unwrap_or_default();
        self.path
            .strip_prefix(&root)
            .unwrap_or(&self.path)
            .display()
            .to_string()
    }

    /// Every block, layer blocks first, with the layer's name (empty for
    /// document-level blocks).
    pub fn all_blocks(&self) -> Vec<(&str, &[u8; 4], &[u8])> {
        let mut out = Vec::new();
        for layer in &self.layers {
            for (key, data) in &layer.blocks {
                out.push((layer.display_name(), key, data.as_slice()));
            }
        }
        for (key, data) in &self.globals {
            out.push(("", key, data.as_slice()));
        }
        out
    }

    /// ag-psd's decoded values for the file (`data.json` beside a
    /// `src.psd`), when present.
    pub fn ag_psd_data(&self) -> Option<serde_json::Value> {
        if self.path.file_name()?.to_str()? != "src.psd" {
            return None;
        }
        let json = std::fs::read(self.path.with_file_name("data.json")).ok()?;
        serde_json::from_slice(&json).ok()
    }

    /// For each layer, ag-psd's decoded layer of the same name (matched in
    /// file order), when the file has a `data.json`.
    pub fn ag_psd_layers(&self) -> Vec<Option<serde_json::Value>> {
        let mut queue: Vec<serde_json::Value> = Vec::new();
        if let Some(data) = self.ag_psd_data() {
            flatten(&data, &mut queue);
        }
        self.layers
            .iter()
            .map(|layer| {
                let at = queue.iter().position(|j| {
                    j.get("name").and_then(|n| n.as_str()) == Some(layer.display_name())
                })?;
                Some(queue.remove(at))
            })
            .collect()
    }
}

/// ag-psd's layer tree in record order (a group after its layers).
fn flatten(node: &serde_json::Value, out: &mut Vec<serde_json::Value>) {
    for child in node
        .get("children")
        .and_then(|c| c.as_array())
        .into_iter()
        .flatten()
    {
        flatten(child, out);
        out.push(child.clone());
    }
}

/// Where descriptors start inside a block's data, for the blocks that hold
/// them.
pub fn descriptor_offsets(key: &[u8; 4], data: &[u8]) -> Vec<usize> {
    let at = |offset: usize| {
        if data.get(offset..offset + 4) == Some(&[0, 0, 0, 16]) {
            vec![offset + 4]
        } else {
            Vec::new()
        }
    };
    match key {
        b"SoCo" | b"GdFl" | b"PtFl" | b"vstk" | b"CgEd" | b"blwh" | b"vibA" | b"artb" | b"artd"
        | b"cinf" | b"pths" | b"anFX" | b"GenI" | b"OCIO" => at(0),
        b"lfx2" | b"lmfx" | b"lfxs" | b"vscg" | b"vogk" | b"CAI " => at(4),
        b"clrL" => at(2),
        b"SoLd" | b"SoLE" => at(8),
        b"TySh" => {
            let text = data.get(56..).unwrap_or_default();
            let Ok((_, used)) = descriptor::read(text) else {
                return vec![56];
            };
            let mut out = vec![56];
            out.extend(at(56 + used + 2));
            out
        }
        b"PlLd" => {
            let n = usize::from(data.get(8).copied().unwrap_or(0));
            at(9 + n + 16 + 64 + 4)
        }
        _ => Vec::new(),
    }
}

/// The corpus directory, when set.
pub fn corpus_dir() -> Option<PathBuf> {
    std::env::var_os("PSD_CORPUS_DIR").map(PathBuf::from)
}

/// Every readable file in the corpus (empty when `PSD_CORPUS_DIR` is
/// unset).
pub fn files() -> Vec<File> {
    let Some(root) = corpus_dir() else {
        eprintln!("PSD_CORPUS_DIR is unset; skipping the corpus check");
        return Vec::new();
    };
    let mut paths = Vec::new();
    collect(&root, &mut paths);
    paths.sort();
    paths
        .into_iter()
        .filter_map(|path| {
            let bytes = std::fs::read(&path).ok()?;
            let file = split(path.clone(), &bytes);
            if file.is_none() {
                eprintln!("could not split {}", path.display());
            }
            file
        })
        .collect()
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("psd") || e.eq_ignore_ascii_case("psb"))
        {
            out.push(path);
        }
    }
}

fn split(path: PathBuf, bytes: &[u8]) -> Option<File> {
    let mut r = Reader::new(bytes);
    if &r.sig().ok()? != b"8BPS" {
        return None;
    }
    let psb = r.u16().ok()? == 2;
    r.skip(6 + 2).ok()?;
    let height = r.u32().ok()?;
    let width = r.u32().ok()?;
    r.skip(4).ok()?;
    let color_mode = r.u32().ok()? as usize;
    r.skip(color_mode).ok()?;
    let resources = r.u32().ok()? as usize;
    let resources = image_resources(r.take(resources).ok()?);
    let section = r.length(psb).ok()?;
    let mut section = r.take(section).ok()?;
    let mut file = File {
        path,
        width,
        height,
        psb,
        resources,
        layers: Vec::new(),
        globals: Vec::new(),
    };
    if section.is_empty() {
        return Some(file);
    }
    let info = section.length(psb).ok()?;
    let mut info = section.take(info).ok()?;
    file.layers = layer_records(&mut info, psb)?;
    if section.remaining() >= 4 {
        let mask = section.u32().ok()? as usize;
        section.skip(mask.min(section.remaining())).ok()?;
    }
    for (key, data) in blocks(&mut section, psb, 4) {
        if key == *b"Lr16" || key == *b"Lr32" {
            let mut nested = Reader::new(&data);
            file.layers.extend(layer_records(&mut nested, psb)?);
        }
        file.globals.push((key, data));
    }
    Some(file)
}

fn image_resources(mut r: Reader<'_>) -> Vec<(u16, Vec<u8>)> {
    let mut out = Vec::new();
    while r.remaining() >= 12 {
        let (Ok(_), Ok(id), Ok(_), Ok(n)) = (r.sig(), r.u16(), r.pascal(2), r.u32()) else {
            break;
        };
        let Ok(data) = r.bytes(n as usize) else { break };
        out.push((id, data.to_vec()));
        if n % 2 == 1 && r.skip(1).is_err() {
            break;
        }
    }
    out
}

fn layer_records(r: &mut Reader<'_>, psb: bool) -> Option<Vec<Layer>> {
    if r.remaining() < 2 {
        return Some(Vec::new());
    }
    let count = r.i16().ok()?.unsigned_abs();
    let mut layers = Vec::new();
    for _ in 0..count {
        r.skip(16).ok()?;
        let channels = r.u16().ok()? as usize;
        r.skip(channels * if psb { 10 } else { 6 }).ok()?;
        r.skip(12).ok()?;
        let extra = r.u32().ok()? as usize;
        let mut extra = r.take(extra).ok()?;
        let mask = extra.u32().ok()? as usize;
        extra.skip(mask).ok()?;
        let ranges = extra.u32().ok()? as usize;
        extra.skip(ranges).ok()?;
        let name = binary_name(extra.pascal(4).ok()?);
        let blocks = blocks(&mut extra, psb, 1);
        let unicode_name = blocks
            .iter()
            .find(|(k, _)| k == b"luni")
            .and_then(|(_, d)| Reader::new(d).unicode().ok());
        layers.push(Layer {
            name,
            unicode_name,
            blocks,
        });
    }
    Some(layers)
}

fn binary_name(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

/// Tagged blocks until the data runs out or a signature is missing.
fn blocks(r: &mut Reader<'_>, psb: bool, pad: usize) -> Vec<([u8; 4], Vec<u8>)> {
    let mut out = Vec::new();
    while r.remaining() >= 12 {
        let Some(sig) = r.peek(4) else { break };
        if sig != b"8BIM" && sig != b"8B64" {
            break;
        }
        let long_sig = sig == b"8B64";
        r.skip(4).ok();
        let Ok(key) = r.sig() else { break };
        let long = long_sig || (psb && LONG_KEYS.contains(&&key));
        let Ok(n) = r.length(long) else { break };
        let Ok(data) = r.bytes(n) else { break };
        out.push((key, data.to_vec()));
        if pad > 1 && n % pad != 0 {
            let skip = (pad - n % pad).min(r.remaining());
            r.skip(skip).ok();
        }
    }
    out
}
