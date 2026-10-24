//! Pixel size and length of a file someone sends from Macro, read from its
//! headers so the timeline and recipients' phones can reserve space for it.

use super::events::MediaShape;
use super::models::MediaKind;
use nom::IResult;
use nom::bytes::complete::take;
use nom::number::complete::{be_i32, be_u8, be_u24, be_u32, be_u64};

/// Whatever the file's headers say; unknown parts stay `None`.
pub fn measure(kind: MediaKind, mime: &str, bytes: &[u8]) -> MediaShape {
    match kind {
        MediaKind::Image => image_shape(bytes),
        MediaKind::Video => mp4_shape(bytes),
        MediaKind::Audio if mime == "audio/ogg" => MediaShape {
            duration_seconds: opus_seconds(bytes),
            ..MediaShape::default()
        },
        MediaKind::Audio if mime == "audio/mp4" || mime == "audio/aac" => MediaShape {
            duration_seconds: mp4_shape(bytes).duration_seconds,
            ..MediaShape::default()
        },
        MediaKind::Audio | MediaKind::Document => MediaShape::default(),
    }
}

fn image_shape(bytes: &[u8]) -> MediaShape {
    let dimensions = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|reader| reader.into_dimensions().ok());
    MediaShape {
        width: dimensions.map(|(width, _)| width),
        height: dimensions.map(|(_, height)| height),
        duration_seconds: None,
    }
}

/// One ISO-BMFF box: its four-letter type and payload.
fn mp4_box(input: &[u8]) -> IResult<&[u8], (&[u8], &[u8])> {
    let (input, size) = be_u32(input)?;
    let (input, kind) = take(4usize)(input)?;
    let (input, payload_len) = match size {
        // To the end of the file.
        0 => (input, input.len()),
        // A 64-bit size follows the type.
        1 => {
            let (input, large) = be_u64(input)?;
            (input, (large as usize).saturating_sub(16))
        }
        size => (input, (size as usize).saturating_sub(8)),
    };
    let (input, payload) = take(payload_len)(input)?;
    Ok((input, (kind, payload)))
}

/// The payloads of the boxes of type `kind` directly inside `input`.
fn children<'file>(input: &'file [u8], kind: &'static [u8]) -> Vec<&'file [u8]> {
    let mut found = vec![];
    let mut rest = input;
    while let Ok((next, (child, payload))) = mp4_box(rest) {
        if child == kind {
            found.push(payload);
        }
        rest = next;
    }
    found
}

/// Movie header: length in seconds.
fn mvhd(input: &[u8]) -> IResult<&[u8], Option<u32>> {
    let (input, version) = be_u8(input)?;
    let (input, _flags) = be_u24(input)?;
    let (input, (timescale, duration)) = if version == 1 {
        let (input, _times) = take(16usize)(input)?;
        let (input, timescale) = be_u32(input)?;
        let (input, duration) = be_u64(input)?;
        (input, (timescale, duration))
    } else {
        let (input, _times) = take(8usize)(input)?;
        let (input, timescale) = be_u32(input)?;
        let (input, duration) = be_u32(input)?;
        (input, (timescale, u64::from(duration)))
    };
    let seconds = (timescale > 0)
        .then(|| (duration as f64 / f64::from(timescale)).round())
        .filter(|seconds| *seconds >= 0.0 && *seconds <= f64::from(u32::MAX))
        .map(|seconds| seconds as u32);
    Ok((input, seconds))
}

/// Track header: the displayed width and height (rotation applied).
fn tkhd(input: &[u8]) -> IResult<&[u8], Option<(u32, u32)>> {
    let (input, version) = be_u8(input)?;
    let (input, _flags) = be_u24(input)?;
    // Times, track id, reserved, duration.
    let (input, _) = take(if version == 1 { 32usize } else { 20usize })(input)?;
    // Reserved, layer, alternate group, volume, reserved.
    let (input, _) = take(16usize)(input)?;
    let (input, a) = be_i32(input)?;
    let (input, b) = be_i32(input)?;
    let (input, _) = take(28usize)(input)?;
    let (input, width) = be_u32(input)?;
    let (input, height) = be_u32(input)?;
    // 16.16 fixed point.
    let (width, height) = (width >> 16, height >> 16);
    if width == 0 || height == 0 {
        return Ok((input, None));
    }
    // A quarter turn shows the frame on its side.
    let turned = a == 0 && b != 0;
    Ok((
        input,
        Some(if turned {
            (height, width)
        } else {
            (width, height)
        }),
    ))
}

fn mp4_shape(bytes: &[u8]) -> MediaShape {
    let Some(moov) = children(bytes, b"moov").into_iter().next() else {
        return MediaShape::default();
    };
    let duration_seconds = children(moov, b"mvhd")
        .into_iter()
        .next()
        .and_then(|header| mvhd(header).ok())
        .and_then(|(_, seconds)| seconds);
    let size = children(moov, b"trak")
        .into_iter()
        .flat_map(|track| children(track, b"tkhd"))
        .find_map(|header| tkhd(header).ok().and_then(|(_, size)| size));
    MediaShape {
        width: size.map(|(width, _)| width),
        height: size.map(|(_, height)| height),
        duration_seconds,
    }
}

/// Ogg/Opus length: the last page's granule position at Opus's fixed 48 kHz,
/// less the stream's pre-skip.
fn opus_seconds(bytes: &[u8]) -> Option<u32> {
    let head = bytes.windows(8).position(|window| window == b"OpusHead")?;
    let pre_skip: [u8; 2] = bytes.get(head + 10..head + 12)?.try_into().ok()?;
    let pre_skip = u64::from(u16::from_le_bytes(pre_skip));
    let last_page = bytes.windows(4).rposition(|window| window == b"OggS")?;
    let granule: [u8; 8] = bytes.get(last_page + 6..last_page + 14)?.try_into().ok()?;
    let samples = u64::from_le_bytes(granule).checked_sub(pre_skip)?;
    u32::try_from((samples + 24_000) / 48_000).ok()
}

#[cfg(test)]
mod test;
