use super::*;

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    image::RgbImage::new(width, height)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    bytes
}

fn mp4_box(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut bytes = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
    bytes.extend_from_slice(kind);
    bytes.extend_from_slice(payload);
    bytes
}

/// A version-0 movie header: `duration` units at `timescale` per second.
fn mvhd_box(timescale: u32, duration: u32) -> Vec<u8> {
    let mut payload = vec![0; 4 + 8];
    payload.extend_from_slice(&timescale.to_be_bytes());
    payload.extend_from_slice(&duration.to_be_bytes());
    payload.extend_from_slice(&[0; 80]);
    mp4_box(b"mvhd", &payload)
}

/// A version-0 track header with the given rotation matrix start and size.
fn tkhd_box(a: i32, b: i32, width: u32, height: u32) -> Vec<u8> {
    let mut payload = vec![0; 4 + 20 + 16];
    payload.extend_from_slice(&a.to_be_bytes());
    payload.extend_from_slice(&b.to_be_bytes());
    payload.extend_from_slice(&[0; 28]);
    payload.extend_from_slice(&(width << 16).to_be_bytes());
    payload.extend_from_slice(&(height << 16).to_be_bytes());
    mp4_box(b"tkhd", &payload)
}

fn mp4(tracks: &[Vec<u8>]) -> Vec<u8> {
    let mut moov = mvhd_box(600, 7500);
    for track in tracks {
        moov.extend(mp4_box(b"trak", track));
    }
    // The media data comes first, as many encoders write it.
    let mut file = mp4_box(b"ftyp", b"isom\0\0\0\0");
    file.extend(mp4_box(b"mdat", &[7; 64]));
    file.extend(mp4_box(b"moov", &moov));
    file
}

#[test]
fn an_image_has_its_pixel_size() {
    assert_eq!(
        measure(MediaKind::Image, "image/png", &png(640, 480)),
        MediaShape {
            width: Some(640),
            height: Some(480),
            duration_seconds: None,
        }
    );
}

#[test]
fn a_video_has_its_track_size_and_length() {
    let audio = tkhd_box(1 << 16, 0, 0, 0);
    let video = tkhd_box(1 << 16, 0, 1920, 1080);
    assert_eq!(
        measure(MediaKind::Video, "video/mp4", &mp4(&[audio, video])),
        MediaShape {
            width: Some(1920),
            height: Some(1080),
            duration_seconds: Some(13),
        }
    );
}

#[test]
fn a_portrait_video_is_measured_as_shown() {
    let turned = tkhd_box(0, 1 << 16, 1920, 1080);
    let shape = measure(MediaKind::Video, "video/mp4", &mp4(&[turned]));
    assert_eq!((shape.width, shape.height), (Some(1080), Some(1920)));
}

#[test]
fn an_opus_voice_note_has_its_length() {
    let mut head = b"OggS".to_vec();
    head.extend_from_slice(&[0; 22]);
    head.extend_from_slice(b"OpusHead");
    head.extend_from_slice(&[1, 1]);
    head.extend_from_slice(&312u16.to_le_bytes());
    head.extend_from_slice(&[0; 7]);
    let mut last = b"OggS".to_vec();
    last.extend_from_slice(&[0, 4]);
    last.extend_from_slice(&(312u64 + 48_000 * 9).to_le_bytes());
    last.extend_from_slice(&[0; 12]);
    let file = [head, last].concat();
    assert_eq!(
        measure(MediaKind::Audio, "audio/ogg", &file).duration_seconds,
        Some(9)
    );
}

#[test]
fn unreadable_files_have_no_shape() {
    for (kind, mime) in [
        (MediaKind::Image, "image/jpeg"),
        (MediaKind::Video, "video/mp4"),
        (MediaKind::Audio, "audio/ogg"),
        (MediaKind::Audio, "audio/mpeg"),
        (MediaKind::Document, "application/pdf"),
    ] {
        assert_eq!(
            measure(kind, mime, b"not really a file"),
            MediaShape::default(),
            "{mime}"
        );
    }
}
