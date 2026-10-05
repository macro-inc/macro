//! Splitting a file into its parts.

use super::{
    Channel, Compression, ESCAPED, Header, ImageData, LAYER_INFO_KEYS, LayerInfo, LayerRecord,
    LayerSection, Level, MaskData, MaskParams, PsdFile, RealMask, Resource, TaggedBlock, corrupt,
    is_block_signature, is_large, pad4, writer_signature,
};
use crate::binary::Reader;
use crate::error::{PsdError, Result};
use crate::model::ColorMode;

/// Bytes other than zeros skipped looking for the next block's signature
/// (and how far back a length that ran into it is followed).
const MAX_STRAY: usize = 4;

/// The fewest bytes a layer record takes.
const MIN_RECORD: usize = 34;

/// Signatures image resources carry.
const RESOURCE_SIGNATURES: [&[u8; 4]; 5] = [b"8BIM", b"MeSa", b"AgHg", b"PHUT", b"DCSR"];

/// Largest canvas side a file may declare.
const MAX_SIDE: u32 = 300_000;

pub(super) fn file(bytes: &[u8]) -> Result<PsdFile> {
    let mut r = Reader::new(bytes);
    let header = header(&mut r)?;
    let psb = header.is_psb();
    let color_mode_data = section(&mut r, false, "the color mode data")?
        .data()
        .to_vec();
    let resources = resources(section(&mut r, false, "the image resources")?);
    let layers = layer_section(section(&mut r, psb, "the layer and mask information")?, psb)?;
    let image = image_data(&mut r)?;
    Ok(PsdFile {
        header,
        color_mode_data,
        resources,
        layers,
        image,
    })
}

fn header(r: &mut Reader) -> Result<Header> {
    if r.peek(4) != Some(b"8BPS".as_slice()) {
        return Err(PsdError::NotPsd);
    }
    r.skip(4)?;
    let version = r.u16()?;
    if version != 1 && version != 2 {
        return Err(PsdError::Unsupported(format!(
            "file format version {version}"
        )));
    }
    // Reserved, always zero.
    r.skip(6)?;
    let header = Header {
        version,
        channels: r.u16()?,
        height: r.u32()?,
        width: r.u32()?,
        depth: r.u16()?,
        mode: r.u16()?,
    };
    if !matches!(header.depth, 1 | 8 | 16 | 32) {
        return Err(PsdError::Unsupported(format!(
            "{} bits per channel",
            header.depth
        )));
    }
    if ColorMode::from_code(header.mode).is_none() {
        return Err(PsdError::Unsupported(format!("color mode {}", header.mode)));
    }
    if header.channels == 0
        || header.width == 0
        || header.height == 0
        || header.width > MAX_SIDE
        || header.height > MAX_SIDE
    {
        return Err(corrupt("the header's size is out of range"));
    }
    Ok(header)
}

/// The next length-prefixed part (a 32-bit length, or 64-bit when `large`).
fn section<'a>(r: &mut Reader<'a>, large: bool, what: &str) -> Result<Reader<'a>> {
    let len = r
        .length(large)
        .map_err(|_| corrupt(&format!("{what} is cut off")))?;
    r.take(len)
        .map_err(|_| corrupt(&format!("{what} runs past the end of the file")))
}

/// Resource blocks. A damaged block ends the list (resources are
/// optional, so the file still opens).
fn resources(mut r: Reader) -> Vec<Resource> {
    let mut out = Vec::new();
    while r.remaining() >= 12 {
        let Ok(resource) = resource(&mut r) else {
            break;
        };
        out.push(resource);
    }
    out
}

fn resource(r: &mut Reader) -> Result<Resource> {
    let signature = r.sig()?;
    let id = r.u16()?;
    let name = r.pascal(2)?.to_vec();
    let len = r.u32()? as usize;
    let data = r.bytes(len)?.to_vec();
    // Data is padded to an even length, unless the next block starts
    // right away.
    let next_starts = r
        .peek(4)
        .is_some_and(|s| RESOURCE_SIGNATURES.iter().any(|sig| sig.as_slice() == s));
    if len % 2 == 1 && !next_starts && !r.is_empty() {
        r.skip(1)?;
    }
    Ok(Resource {
        signature,
        id,
        name,
        data,
    })
}

fn layer_section(mut r: Reader, psb: bool) -> Result<LayerSection> {
    let mut section = LayerSection::default();
    if r.is_empty() {
        return Ok(section);
    }
    let mut info = self::section(&mut r, psb, "the layer info")?;
    let stored = !info.is_empty();
    if stored {
        let (layers, used) = layer_info(&mut info, psb)?;
        let padding = info.remaining();
        section.info_padding = if !layers.records.is_empty() && padding == pad4(used) {
            padding
        } else {
            padding + ESCAPED
        };
        section.info = layers;
    }
    // The global layer mask info; some writers leave it out.
    if r.remaining() >= 4 && !is_block_signature(r.peek(4).unwrap_or_default()) {
        let start = r.pos();
        let len = r.u32()? as usize;
        match r.bytes(len) {
            Ok(mask) => section.global_mask = Some(mask.to_vec()),
            // Kept, with what follows, as the tail.
            Err(_) => r.seek(start),
        }
    }
    let (tagged, tail) = blocks(&mut r, psb, Level::Document);
    section.tagged = tagged;
    section.tail = tail;
    if !stored {
        take_layer_info_block(&mut section, psb);
    }
    Ok(section)
}

/// Moves the layers of a 16- or 32-bit document out of their `Lr16` or
/// `Lr32` block into [`LayerSection::info`], leaving the block empty as a
/// marker. A block that does not parse stays as it is.
fn take_layer_info_block(section: &mut LayerSection, psb: bool) {
    let Some(block) = section
        .tagged
        .iter_mut()
        .find(|b| LAYER_INFO_KEYS.contains(&&b.key))
    else {
        return;
    };
    let mut r = Reader::new(&block.data);
    let Ok((info, used)) = layer_info(&mut r, psb) else {
        return;
    };
    let padding = &block.data[used..];
    if padding.iter().any(|&b| b != 0) {
        return;
    }
    section.info_padding = if padding.is_empty() {
        0
    } else {
        padding.len() + ESCAPED
    };
    section.info = info;
    section.info_key = Some(block.key);
    block.data = Vec::new();
}

/// Layer records and their channel data; returns them and the bytes they
/// took.
fn layer_info(r: &mut Reader, psb: bool) -> Result<(LayerInfo, usize)> {
    let start = r.pos();
    let count = r.i16()?;
    let n = usize::from(count.unsigned_abs());
    if n > r.remaining() / MIN_RECORD {
        return Err(corrupt("the layer count is larger than the layer info"));
    }
    let mut records = Vec::with_capacity(n);
    let mut lengths = Vec::with_capacity(n);
    for _ in 0..n {
        let (record, channel_lengths) = layer_record(r, psb)?;
        records.push(record);
        lengths.push(channel_lengths);
    }
    for (record, channel_lengths) in records.iter_mut().zip(lengths) {
        for (channel, len) in record.channels.iter_mut().zip(channel_lengths) {
            channel_data(r, channel, len)?;
        }
    }
    let info = LayerInfo {
        merged_alpha: count < 0,
        records,
    };
    Ok((info, r.pos() - start))
}

/// A layer record, with its channels' data lengths (the data follows all
/// records).
fn layer_record(r: &mut Reader, psb: bool) -> Result<(LayerRecord, Vec<usize>)> {
    let rect = [r.i32()?, r.i32()?, r.i32()?, r.i32()?];
    let count = usize::from(r.u16()?);
    let entry = if psb { 10 } else { 6 };
    if count > r.remaining() / entry {
        return Err(corrupt("a layer record lists more channels than it holds"));
    }
    let mut channels = Vec::with_capacity(count);
    let mut lengths = Vec::with_capacity(count);
    for _ in 0..count {
        let id = r.i16()?;
        lengths.push(r.length(psb)?);
        channels.push(Channel {
            id,
            compression: Compression::Raw,
            bytes: Vec::new(),
        });
    }
    if &r.sig()? != b"8BIM" {
        return Err(corrupt("a layer record has no blend mode signature"));
    }
    let blend = r.sig()?;
    let opacity = r.u8()?;
    let clipping = r.u8()?;
    let flags = r.u8()?;
    let filler = r.u8()?;
    let len = r.u32()? as usize;
    let mut extra = r
        .take(len)
        .map_err(|_| corrupt("a layer record runs past the layer info"))?;
    let has_real_mask = channels.iter().any(|c| c.id == -3);
    let mask_len = extra.u32()? as usize;
    let mask = mask_data(extra.bytes(mask_len)?, has_real_mask)?;
    let ranges_len = extra.u32()? as usize;
    let blend_ranges = extra.bytes(ranges_len)?.to_vec();
    let name_len = usize::from(extra.u8()?);
    let name = extra.bytes(name_len)?.to_vec();
    let padding = name_padding(&extra);
    extra.skip(padding)?;
    let name_padding = if padding == pad4(1 + name_len) {
        padding
    } else {
        padding + ESCAPED
    };
    let (tagged, extra_tail) = blocks(&mut extra, psb, Level::Record);
    let record = LayerRecord {
        rect,
        channels,
        blend,
        opacity,
        clipping,
        flags,
        filler,
        mask,
        blend_ranges,
        name,
        tagged,
        extra_tail,
        name_padding,
    };
    Ok((record, lengths))
}

/// The bytes between a record's name and its first block: zeros, and a
/// few stray bytes when a signature follows them.
fn name_padding(r: &Reader) -> usize {
    let rest = &r.data()[r.pos()..];
    let zeros = rest.iter().take_while(|&&b| b == 0).count();
    if zeros == rest.len() || is_block_signature(&rest[zeros..]) {
        return zeros;
    }
    (zeros + 1..=zeros + MAX_STRAY)
        .find(|&at| is_block_signature(rest.get(at..).unwrap_or_default()))
        .unwrap_or(zeros)
}

/// Mask data. The real user mask comes before the parameters; whether it
/// is there is told by the record's real-mask channel, or by the length
/// when no parameters could fill it instead.
fn mask_data(bytes: &[u8], has_real_mask: bool) -> Result<Option<MaskData>> {
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.len() < 18 {
        return Err(corrupt("a layer's mask data is cut off"));
    }
    let mut r = Reader::new(bytes);
    let rect = [r.i32()?, r.i32()?, r.i32()?, r.i32()?];
    let default_color = r.u8()?;
    let flags = r.u8()?;
    let has_params = flags & 0x10 != 0;
    let real = if bytes.len() >= 36 && (has_real_mask || !has_params) {
        Some(RealMask {
            flags: r.u8()?,
            default_color: r.u8()?,
            rect: [r.i32()?, r.i32()?, r.i32()?, r.i32()?],
        })
    } else {
        None
    };
    let params = if has_params && !r.is_empty() {
        Some(mask_params(&mut r))
    } else {
        None
    };
    Ok(Some(MaskData {
        rect,
        default_color,
        flags,
        params,
        real,
    }))
}

/// Mask parameters; fields cut off by the end of the mask data are left
/// out.
fn mask_params(r: &mut Reader) -> MaskParams {
    let bits = r.u8().unwrap_or(0);
    let mut params = MaskParams::default();
    if bits & 1 != 0 {
        params.user_density = r.u8().ok();
    }
    if bits & 2 != 0 {
        params.user_feather = r.f64().ok();
    }
    if bits & 4 != 0 {
        params.vector_density = r.u8().ok();
    }
    if bits & 8 != 0 {
        params.vector_feather = r.f64().ok();
    }
    params
}

fn channel_data(r: &mut Reader, channel: &mut Channel, len: usize) -> Result<()> {
    match len {
        // No data, not even a compression code.
        0 => Ok(()),
        1 => Err(corrupt("a channel's data is one byte long")),
        _ => {
            let code = r.u16()?;
            channel.compression = Compression::from_code(code)
                .ok_or_else(|| corrupt(&format!("unknown channel compression {code}")))?;
            channel.bytes = r
                .bytes(len - 2)
                .map_err(|_| corrupt("a channel's data runs past the layer info"))?
                .to_vec();
            Ok(())
        }
    }
}

/// Tagged blocks until a part ends; returns them and the bytes after the
/// last one that do not form a block.
fn blocks(r: &mut Reader, psb: bool, level: Level) -> (Vec<TaggedBlock>, Vec<u8>) {
    let mut out = Vec::new();
    while r.remaining() >= 12 && is_block_signature(r.peek(4).unwrap_or_default()) {
        let start = r.pos();
        match block(r, psb, level) {
            Some(block) => out.push(block),
            None => {
                r.seek(start);
                break;
            }
        }
    }
    let tail = r.data()[r.pos()..].to_vec();
    r.seek(r.data().len());
    (out, tail)
}

/// A block, and what lies between its data and the next block: zero
/// padding, stray bytes, or nothing at all when the length ran into the
/// next signature (as files whose writers padded differently than they
/// counted have).
fn block(r: &mut Reader, psb: bool, level: Level) -> Option<TaggedBlock> {
    let signature = r.sig().ok()?;
    let key = r.sig().ok()?;
    let len = r.length(is_large(&signature, &key, psb)).ok()?;
    let start = r.pos();
    r.skip(len).ok()?;
    let mut end = r.pos();
    let rest = &r.data()[end..];
    let zeros = rest.iter().take_while(|&&b| b == 0).count();
    let skip = if zeros == rest.len() || is_block_signature(&rest[zeros..]) {
        Some(zeros)
    } else {
        (zeros + 1..=zeros + MAX_STRAY)
            .find(|&at| is_block_signature(rest.get(at..).unwrap_or_default()))
    };
    let mut realigned = false;
    let gap = match skip {
        Some(n) => n,
        None => {
            match (1..=MAX_STRAY.min(len)).find(|&back| is_block_signature(&r.data()[end - back..]))
            {
                Some(back) => {
                    end -= back;
                    realigned = true;
                    0
                }
                // Stray bytes follow: they and the rest of the part are
                // its tail.
                None => zeros,
            }
        }
    };
    r.seek(end + gap);
    let data = r.data()[start..end].to_vec();
    let after = &r.data()[end..end + gap];
    let standard = !realigned
        && signature == writer_signature(&key, psb)
        && match level {
            Level::Record => after.is_empty() && data.len().is_multiple_of(4),
            Level::Document => after.len() == pad4(data.len()) && after.iter().all(|&b| b == 0),
        };
    Some(TaggedBlock {
        signature,
        key,
        data,
        padding: (!standard).then(|| after.to_vec()),
        length_includes_padding: false,
    })
}

/// The merged image: a compression code, then the rest of the file. A file
/// that ends before it reads as having none.
fn image_data(r: &mut Reader) -> Result<ImageData> {
    if r.remaining() < 2 {
        return Ok(ImageData {
            compression: Compression::Raw,
            bytes: Vec::new(),
        });
    }
    let code = r.u16()?;
    let compression = Compression::from_code(code)
        .ok_or_else(|| corrupt(&format!("unknown merged image compression {code}")))?;
    Ok(ImageData {
        compression,
        bytes: r.data()[r.pos()..].to_vec(),
    })
}
