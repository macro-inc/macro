//! Checks against real files: every `.psd` and `.psb` under the directory
//! `PSD_CORPUS_DIR` names, and, beside a `src.psd` or `src.psb`, the
//! `canvas.png` and `layer-N.png` renderings ag-psd's test corpus keeps.
//! Run with `PSD_CORPUS_DIR=… cargo test -p psd_engine -- --ignored
//! --nocapture`; with `PSD_DUMP_DIR` set, the decoded merged images are
//! written there as PNG too.

use super::*;
use crate::channels::{decode_channel, decode_image, encode_channel, encode_image};
use crate::color::{to_gray, to_rgba};
use crate::model::ColorMode;
use std::path::{Path, PathBuf};

/// The corpus files, or `None` when no corpus is configured.
fn corpus() -> Option<Vec<PathBuf>> {
    let dir = std::env::var_os("PSD_CORPUS_DIR")?;
    let mut files = Vec::new();
    walk(Path::new(&dir), &mut files);
    files.sort();
    Some(files)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("psd") || e.eq_ignore_ascii_case("psb"))
        {
            out.push(path);
        }
    }
}

/// Files with ag-psd's renderings beside them.
fn rendered(files: &[PathBuf]) -> impl Iterator<Item = (&PathBuf, PsdFile)> {
    files
        .iter()
        .filter(|p| {
            p.file_stem().is_some_and(|s| s == "src") && p.with_file_name("canvas.png").exists()
        })
        .map(|p| (p, read(&std::fs::read(p).unwrap()).unwrap()))
}

/// A PNG as RGBA8.
fn png(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let bytes = std::fs::read(path).ok()?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    let channels = match info.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Grayscale => 1,
        png::ColorType::Indexed => return None,
    };
    let rgba = buf
        .chunks_exact(channels)
        .flat_map(|p| match channels {
            4 => [p[0], p[1], p[2], p[3]],
            3 => [p[0], p[1], p[2], 255],
            2 => [p[0], p[0], p[0], p[1]],
            _ => [p[0], p[0], p[0], 255],
        })
        .collect();
    Some((info.width, info.height, rgba))
}

fn write_png(path: &Path, width: u32, height: u32, rgba: &[u8]) {
    let file = std::fs::File::create(path).unwrap();
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(rgba)
        .unwrap();
}

/// The largest difference between two RGBA images' channels, and how many
/// pixels differ (fully transparent pixels match whatever their color).
fn compare(a: &[u8], b: &[u8]) -> (u8, usize) {
    let mut max = 0;
    let mut pixels = 0;
    for (p, q) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
        if p[3] == 0 && q[3] == 0 {
            continue;
        }
        let d = p
            .iter()
            .zip(q)
            .map(|(x, y)| x.abs_diff(*y))
            .max()
            .unwrap_or(0);
        max = max.max(d);
        pixels += usize::from(d > 0);
    }
    (max, pixels)
}

/// Pixels as ag-psd's renderings store them: they went through a node
/// canvas, which premultiplies (truncating, in `f32`) and cairo's PNG
/// writer, which divides back (rounding).
fn through_canvas(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3];
        match a {
            0 => px.fill(0),
            255 => {}
            _ => {
                let alpha = f32::from(a) / 255.0;
                for c in &mut px[..3] {
                    let premultiplied = u32::from((f32::from(*c) * alpha) as u8);
                    *c = ((premultiplied * 255 + u32::from(a) / 2) / u32::from(a)) as u8;
                }
            }
        }
    }
}

fn name(path: &Path) -> String {
    path.parent()
        .and_then(Path::file_name)
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[test]
#[ignore = "needs PSD_CORPUS_DIR"]
fn corpus_round_trips_byte_for_byte() {
    let Some(files) = corpus() else {
        return;
    };
    let mut failed = Vec::new();
    for path in &files {
        let bytes = std::fs::read(path).unwrap();
        let outcome = match read(&bytes) {
            Ok(file) => {
                let out = write(&file);
                (out != bytes).then(|| {
                    let at = out.iter().zip(&bytes).position(|(a, b)| a != b);
                    format!(
                        "differs at {at:?} (wrote {} of {} bytes)",
                        out.len(),
                        bytes.len()
                    )
                })
            }
            Err(e) => Some(format!("does not read: {e}")),
        };
        if let Some(why) = outcome {
            failed.push(format!("{}: {why}", path.display()));
        }
    }
    println!(
        "round trip: {} of {} files byte for byte",
        files.len() - failed.len(),
        files.len()
    );
    for f in &failed {
        println!("  {f}");
    }
    assert!(failed.is_empty());
}

/// The merged image as ag-psd renders it: the fourth channel (or an
/// alpha after gray) as transparency, colors unmatted from white when the
/// layer count says the merged image has transparency.
fn merged_rgba(file: &PsdFile) -> Vec<u8> {
    let h = &file.header;
    let mode = ColorMode::from_code(h.mode).unwrap();
    let planes = decode_image(&file.image, h).unwrap();
    let colors = mode.color_channels();
    let alpha = match mode {
        ColorMode::Rgb if planes.len() > 3 => planes.get(3),
        ColorMode::Grayscale if file.layers.info.merged_alpha => planes.get(1),
        _ => None,
    };
    let color: Vec<&[u8]> = planes[..colors.min(planes.len())]
        .iter()
        .map(Vec::as_slice)
        .collect();
    let mut rgba = to_rgba(
        mode,
        h.depth,
        h.width,
        h.height,
        &color,
        alpha.map(Vec::as_slice),
        &file.color_mode_data,
    );
    if file.layers.info.merged_alpha && h.depth == 8 {
        for px in rgba.chunks_exact_mut(4) {
            let a = px[3];
            if a != 0 && a != 255 {
                let ra = 1.0 / (f64::from(a) / 255.0);
                let matte = 255.0 * (1.0 - ra);
                for c in &mut px[..3] {
                    *c = (f64::from(*c) * ra + matte)
                        .clamp(0.0, 255.0)
                        .round_ties_even() as u8;
                }
            }
        }
    }
    rgba
}

#[test]
#[ignore = "needs PSD_CORPUS_DIR"]
fn corpus_merged_images_match_their_renderings() {
    let Some(files) = corpus() else {
        return;
    };
    let dump = std::env::var_os("PSD_DUMP_DIR").map(PathBuf::from);
    let mut mismatched = Vec::new();
    let mut count = 0;
    // In ag-psd's `write` fixtures, `canvas.png` is the image written into
    // `expected.psd`, not a rendering of the source file.
    let written = |p: &Path| p.components().any(|c| c.as_os_str() == "write");
    for (path, file) in rendered(&files).filter(|(p, _)| !written(p)) {
        let h = file.header;
        let mut ours = merged_rgba(&file);
        if let Some(dir) = &dump {
            write_png(
                &dir.join(format!("{}.png", name(path))),
                h.width,
                h.height,
                &ours,
            );
        }
        through_canvas(&mut ours);
        let (w, hh, theirs) = png(&path.with_file_name("canvas.png")).unwrap();
        assert_eq!((w, hh), (h.width, h.height), "{}", path.display());
        let (max, pixels) = compare(&ours, &theirs);
        count += 1;
        println!(
            "merged {:<28} depth {:>2} mode {} max diff {max:>3} in {pixels} pixels",
            name(path),
            h.depth,
            h.mode
        );
        if h.depth <= 8 && max > 0 {
            mismatched.push(name(path));
        }
    }
    println!(
        "merged images: {} of {count} at 8 bits or less match exactly",
        count - mismatched.len()
    );
    assert!(mismatched.is_empty(), "{mismatched:?}");
}

/// A record's section kind: 1, 2 open and closed groups, 3 a group's end.
fn section_kind(record: &LayerRecord) -> u32 {
    record
        .block(b"lsct")
        .or_else(|| record.block(b"lsdk"))
        .and_then(|b| b.data.get(..4))
        .map_or(0, |d| u32::from_be_bytes([d[0], d[1], d[2], d[3]]))
}

/// Record indices numbered as ag-psd names its `layer-N.png` files: a
/// depth-first walk of the layer tree, bottom first, where groups only
/// take a number when they have a mask.
fn numbered_layers(records: &[LayerRecord]) -> Vec<(usize, usize)> {
    enum Node {
        Layer(usize),
        Group(usize, Vec<Node>),
    }
    fn walk(
        nodes: &[Node],
        records: &[LayerRecord],
        next: &mut usize,
        out: &mut Vec<(usize, usize)>,
    ) {
        for node in nodes {
            match node {
                Node::Layer(i) => {
                    out.push((*next, *i));
                    *next += 1;
                }
                Node::Group(i, children) => {
                    *next += usize::from(records[*i].mask.is_some());
                    walk(children, records, next, out);
                }
            }
        }
    }
    let mut stack: Vec<(Option<usize>, Vec<Node>)> = vec![(None, Vec::new())];
    for (i, record) in records.iter().enumerate().rev() {
        match section_kind(record) {
            1 | 2 => stack.push((Some(i), Vec::new())),
            3 if stack.len() > 1 => {
                let (group, mut children) = stack.pop().unwrap();
                children.reverse();
                let parent = &mut stack.last_mut().unwrap().1;
                parent.push(Node::Group(group.unwrap(), children));
            }
            _ => stack.last_mut().unwrap().1.push(Node::Layer(i)),
        }
    }
    while stack.len() > 1 {
        let (group, mut children) = stack.pop().unwrap();
        children.reverse();
        stack
            .last_mut()
            .unwrap()
            .1
            .push(Node::Group(group.unwrap(), children));
    }
    let mut roots = stack.pop().unwrap().1;
    roots.reverse();
    let mut out = Vec::new();
    walk(&roots, records, &mut 0, &mut out);
    out
}

/// A layer's pixels as RGBA, as ag-psd renders them (its mask not
/// applied).
fn layer_rgba(file: &PsdFile, record: &LayerRecord) -> (u32, u32, Vec<u8>) {
    let h = &file.header;
    let mode = ColorMode::from_code(h.mode).unwrap();
    let rect = record.rect();
    let (w, hh) = (rect.w as u32, rect.h as u32);
    let decode = |id: i16| {
        record
            .channel(id)
            .map(|c| decode_channel(c, w, hh, h.depth, h.is_psb()).unwrap())
    };
    let color: Vec<Vec<u8>> = (0..mode.color_channels() as i16)
        .map(|id| decode(id).unwrap_or_default())
        .collect();
    let color: Vec<&[u8]> = color.iter().map(Vec::as_slice).collect();
    let alpha = decode(-1);
    let rgba = to_rgba(
        mode,
        h.depth,
        w,
        hh,
        &color,
        alpha.as_deref(),
        &file.color_mode_data,
    );
    (w, hh, rgba)
}

/// A 32-bit RGB layer converted as ag-psd converts floats (a 2.2 power,
/// not the sRGB curve), to check the decoded samples themselves.
fn float_layer_rgba(file: &PsdFile, record: &LayerRecord) -> Vec<u8> {
    let rect = record.rect();
    let (w, h) = (rect.w as u32, rect.h as u32);
    let floats = |id: i16| -> Vec<f64> {
        record
            .channel(id)
            .map(|c| decode_channel(c, w, h, 32, file.header.is_psb()).unwrap())
            .map(|s| {
                s.chunks_exact(4)
                    .map(|b| f64::from(f32::from_be_bytes([b[0], b[1], b[2], b[3]])))
                    .collect()
            })
            .unwrap_or_else(|| vec![1.0; (w * h) as usize])
    };
    let [r, g, b, a] = [0, 1, 2, -1].map(floats);
    let gamma = |v: f64| (v.powf(1.0 / 2.2) * 255.0).round().clamp(0.0, 255.0) as u8;
    (0..r.len())
        .flat_map(|i| {
            [
                gamma(r[i]),
                gamma(g[i]),
                gamma(b[i]),
                (a[i] * 255.0).round().clamp(0.0, 255.0) as u8,
            ]
        })
        .collect()
}

/// Compares a layer's pixels and mask with ag-psd's `layer-N.png` and
/// `layer-N-mask.png`; returns `(name, max difference, pixels)` for each
/// image found.
fn compare_layer(
    path: &Path,
    file: &PsdFile,
    record: &LayerRecord,
    n: usize,
) -> Vec<(String, u8, usize)> {
    let mut out = Vec::new();
    let rect = record.rect();
    let size = (rect.w as u32, rect.h as u32);
    let image = png(&path.with_file_name(format!("layer-{n}.png")));
    if let Some((_, _, theirs)) = image.filter(|(w, h, _)| (*w, *h) == size) {
        let (_, _, mut ours) = layer_rgba(file, record);
        through_canvas(&mut ours);
        let (max, pixels) = compare(&ours, &theirs);
        out.push((format!("layer-{n}"), max, pixels));
        if file.header.depth == 32 {
            let mut floats = float_layer_rgba(file, record);
            through_canvas(&mut floats);
            let (max, pixels) = compare(&floats, &theirs);
            out.push((
                format!("layer-{n} (as ag-psd converts floats)"),
                max,
                pixels,
            ));
        }
    }
    let Some(mask) = &record.mask else {
        return out;
    };
    let [top, left, bottom, right] = mask.rect;
    let size = ((right - left) as u32, (bottom - top) as u32);
    let image = png(&path.with_file_name(format!("layer-{n}-mask.png")));
    if let Some((w, h, theirs)) = image.filter(|(w, h, _)| (*w, *h) == size) {
        let channel = record.channel(-2).unwrap();
        let samples =
            decode_channel(channel, w, h, file.header.depth, file.header.is_psb()).unwrap();
        let gray = to_gray(file.header.depth, w, h, &samples);
        let ours: Vec<u8> = gray.iter().flat_map(|&g| [g, g, g, 255]).collect();
        let (max, pixels) = compare(&ours, &theirs);
        out.push((format!("layer-{n}-mask"), max, pixels));
    }
    out
}

#[test]
#[ignore = "needs PSD_CORPUS_DIR"]
fn corpus_layers_match_their_renderings() {
    let Some(files) = corpus() else {
        return;
    };
    let mut compared = 0;
    let mut mismatched = Vec::new();
    for (path, file) in rendered(&files) {
        let records = &file.layers.info.records;
        let mut worst = (0, 0);
        let mut images = 0;
        for (n, i) in numbered_layers(records) {
            for (image, max, pixels) in compare_layer(path, &file, &records[i], n) {
                images += 1;
                // 32-bit layers differ from ag-psd's 2.2 gamma by design;
                // their samples must match ag-psd's conversion exactly.
                let exact = file.header.depth <= 8 || image.contains("floats");
                if exact && max > 0 {
                    mismatched.push(format!("{} {image}: max {max} in {pixels}", name(path)));
                }
                if !image.contains("floats") {
                    worst = worst.max((max, pixels));
                }
            }
        }
        if images > 0 {
            compared += images;
            println!(
                "layers {:<28} depth {:>2}: {images} images, worst max diff {} in {} pixels",
                name(path),
                file.header.depth,
                worst.0,
                worst.1
            );
        }
    }
    println!(
        "layer images compared: {compared}, exact mismatches: {}",
        mismatched.len()
    );
    for m in &mismatched {
        println!("  {m}");
    }
    assert!(mismatched.is_empty());
}

#[test]
#[ignore = "needs PSD_CORPUS_DIR"]
fn corpus_channels_encode_as_photoshop_does() {
    let Some(files) = corpus() else {
        return;
    };
    let (mut channels, mut identical, mut images, mut identical_images) = (0, 0, 0, 0);
    for path in &files {
        let file = read(&std::fs::read(path).unwrap()).unwrap();
        let h = file.header;
        for record in &file.layers.info.records {
            for channel in &record.channels {
                let (w, hh) = match (channel.id, &record.mask) {
                    (-2, Some(m)) => {
                        let [top, left, bottom, right] = m.rect;
                        ((right - left).max(0) as u32, (bottom - top).max(0) as u32)
                    }
                    (
                        -3,
                        Some(MaskData {
                            real: Some(real), ..
                        }),
                    ) => {
                        let [top, left, bottom, right] = real.rect;
                        ((right - left).max(0) as u32, (bottom - top).max(0) as u32)
                    }
                    _ => (record.rect().w as u32, record.rect().h as u32),
                };
                let samples = decode_channel(channel, w, hh, h.depth, h.is_psb()).unwrap();
                let again = encode_channel(channel.id, &samples, w, hh, h.depth, h.is_psb());
                assert_eq!(
                    decode_channel(&again, w, hh, h.depth, h.is_psb()).unwrap(),
                    samples,
                    "{}",
                    path.display()
                );
                channels += 1;
                identical += usize::from(again == *channel);
            }
        }
        let planes = decode_image(&file.image, &h).unwrap();
        let again = encode_image(&planes, &h, file.image.compression);
        assert_eq!(
            decode_image(&again, &h).unwrap(),
            planes,
            "{}",
            path.display()
        );
        images += 1;
        identical_images += usize::from(again == file.image);
    }
    println!("layer channels re-encoded identically: {identical} of {channels}");
    println!("merged images re-encoded identically: {identical_images} of {images}");
}

/// `luni` data: a name's UTF-16 units after their count.
fn unicode(name: &str) -> Vec<u8> {
    let units: Vec<u16> = name.encode_utf16().collect();
    let mut out = (units.len() as u32).to_be_bytes().to_vec();
    out.extend(units.iter().flat_map(|u| u.to_be_bytes()));
    out
}

/// A 16×8 red layer, every other pixel half transparent, encoded as
/// Photoshop encodes the file's depth.
fn added_layer(h: &Header, mode: ColorMode) -> LayerRecord {
    let (w, hh) = (16, 8);
    let rgba: Vec<u8> = (0..w * hh)
        .flat_map(|i| [255, 0, 0, if i % 2 == 0 { 255 } else { 128 }])
        .collect();
    let mut planes = crate::color::from_rgba(mode, h.depth, w, hh, &rgba);
    let alpha = planes.pop().unwrap();
    let mut channels = vec![encode_channel(-1, &alpha, w, hh, h.depth, h.is_psb())];
    for (id, plane) in planes.iter().enumerate() {
        channels.push(encode_channel(id as i16, plane, w, hh, h.depth, h.is_psb()));
    }
    LayerRecord {
        rect: [2, 3, 2 + hh as i32, 3 + w as i32],
        channels,
        blend: *b"norm",
        opacity: 255,
        clipping: 0,
        flags: 8,
        filler: 0,
        mask: None,
        blend_ranges: Vec::new(),
        name: b"Added".to_vec(),
        tagged: vec![TaggedBlock::new(b"luni", unicode("Added"))],
        extra_tail: Vec::new(),
        name_padding: 0,
    }
}

/// Edits a file as saves will: inverts the first layer with pixels,
/// renames the top layer, drops `lnsr` blocks, adds a layer on top, and
/// gives document blocks Photoshop's layout. Returns the inverted layer's
/// index and pixels; `None` for files this does not apply to.
fn edit(file: &mut PsdFile) -> Option<Option<(usize, Vec<u8>)>> {
    let h = file.header;
    let mode = ColorMode::from_code(h.mode)?;
    if !matches!(mode, ColorMode::Rgb | ColorMode::Grayscale) || file.layers.info.records.is_empty()
    {
        return None;
    }
    let target = file.layers.info.records.iter().position(|r| {
        section_kind(r) == 0
            && !r.rect().is_empty()
            && r.channel(0).is_some_and(|c| !c.bytes.is_empty())
    });
    let mut inverted = None;
    if let Some(i) = target {
        let (w, hh, mut rgba) = layer_rgba(file, &file.layers.info.records[i]);
        for px in rgba.chunks_exact_mut(4) {
            for c in &mut px[..3] {
                *c = 255 - *c;
            }
        }
        let mut planes = crate::color::from_rgba(mode, h.depth, w, hh, &rgba);
        planes.pop();
        let record = &mut file.layers.info.records[i];
        for (id, plane) in planes.iter().enumerate() {
            let id = id as i16;
            if let Some(channel) = record.channels.iter_mut().find(|c| c.id == id) {
                *channel = encode_channel(id, plane, w, hh, h.depth, h.is_psb());
            }
        }
        inverted = Some((i, rgba));
    }
    let records = &mut file.layers.info.records;
    let top = records.last_mut()?;
    top.name = crate::binary::to_mac_roman("Renamed é");
    top.set_block(b"luni", unicode("Renamed é"));
    for record in records.iter_mut() {
        record.remove_block(b"lnsr");
    }
    records.push(added_layer(&h, mode));
    let info_key = file.layers.info_key;
    for block in &mut file.layers.tagged {
        if Some(block.key) != info_key {
            block.padding = None;
        }
    }
    Some(inverted)
}

#[test]
#[ignore = "needs PSD_CORPUS_DIR"]
fn corpus_edits_read_back() {
    let Some(files) = corpus() else {
        return;
    };
    let out_dir = std::env::var_os("PSD_OUT_DIR").map(PathBuf::from);
    let mut edited = 0;
    for path in &files {
        let mut file = read(&std::fs::read(path).unwrap()).unwrap();
        let count = file.layers.info.records.len();
        let Some(inverted) = edit(&mut file) else {
            continue;
        };
        let bytes = write(&file);
        let again = read(&bytes).unwrap();
        // What was written writes back unchanged.
        assert_eq!(write(&again), bytes, "{}", path.display());
        let records = &again.layers.info.records;
        assert_eq!(records.len(), count + 1);
        assert_eq!(records[count].name, b"Added");
        assert_eq!(
            records[count - 1].block(b"luni").unwrap().data[..4],
            [0, 0, 0, 9]
        );
        assert!(records.iter().all(|r| r.block(b"lnsr").is_none()));
        if let Some((i, rgba)) = inverted {
            let (_, _, ours) = layer_rgba(&again, &records[i]);
            let same = ours
                .chunks_exact(4)
                .zip(rgba.chunks_exact(4))
                .filter(|(a, _)| a[3] != 0)
                .all(|(a, b)| a[..3].iter().zip(&b[..3]).all(|(x, y)| x.abs_diff(*y) <= 1));
            assert!(same, "{}", path.display());
        }
        edited += 1;
        if let Some(dir) = &out_dir {
            let ext = if again.header.is_psb() { "psb" } else { "psd" };
            let stem = path.file_stem().unwrap().to_string_lossy();
            std::fs::write(dir.join(format!("{}-{stem}.{ext}", name(path))), &bytes).unwrap();
        }
    }
    println!("edited files written and read back: {edited}");
}
