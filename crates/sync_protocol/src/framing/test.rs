use super::*;

#[test]
fn single_frame_small_payload() {
    let payload = b"hello";
    let frames = into_frames(payload, MAX_CHUNK_SIZE);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0][0], 1);
    assert_eq!(&frames[0][1..], payload);
}

#[test]
fn exact_boundary_is_one_frame() {
    let payload = vec![7u8; 4];
    let frames = into_frames(&payload, 4);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0][0], 1);
    assert_eq!(&frames[0][1..], payload.as_slice());
}

#[test]
fn multi_frame_splits_and_flags() {
    let payload: Vec<u8> = (0..10).collect();
    let frames = into_frames(&payload, 4); // 4 + 4 + 2 => 3 frames
    assert_eq!(frames.len(), 3);
    assert_eq!(frames[0][0], 0);
    assert_eq!(frames[1][0], 0);
    assert_eq!(frames[2][0], 1);

    let reassembled: Vec<u8> = frames.iter().flat_map(|f| f[1..].iter().copied()).collect();
    assert_eq!(reassembled, payload);
}

#[test]
fn empty_payload_yields_one_final_frame() {
    assert_eq!(into_frames(&[], 4), vec![vec![1u8]]);
}

#[test]
fn strip_frame_reads_header() {
    assert_eq!(strip_frame(&[1, 2, 3]).unwrap(), (true, &[2, 3][..]));
    assert_eq!(strip_frame(&[0, 9]).unwrap(), (false, &[9][..]));
    assert_eq!(strip_frame(&[2, 3]).unwrap(), (true, &[3][..]));
    assert_eq!(
        strip_frame(&[]).unwrap_err().to_string(),
        "received empty websocket frame"
    );
}

#[test]
fn round_trip() {
    let payload: Vec<u8> = (0..1000u32).map(|i| i as u8).collect();
    let frames = into_frames(&payload, 64);

    let mut out = Vec::new();
    for frame in &frames {
        let (_is_final, body) = strip_frame(frame).unwrap();
        out.extend_from_slice(body);
    }
    assert_eq!(out, payload);
}

#[test]
fn reassembler_single_final_frame() {
    let mut r = Reassembler::default();
    assert_eq!(r.push(&[1, 9, 8, 7]).unwrap(), Some(vec![9, 8, 7]));
}

#[test]
fn reassembler_returns_none_until_final() {
    let mut r = Reassembler::default();
    assert_eq!(r.push(&[0, 1, 2]).unwrap(), None);
    assert_eq!(r.push(&[0, 3]).unwrap(), None);
    assert_eq!(r.push(&[1, 4, 5]).unwrap(), Some(vec![1, 2, 3, 4, 5]));
}

#[test]
fn reassembler_round_trips_with_into_frames() {
    let payload: Vec<u8> = (0..1000u32).map(|i| i as u8).collect();
    let mut r = Reassembler::default();
    let mut out = None;
    for frame in into_frames(&payload, 64) {
        out = r.push(&frame).unwrap();
    }
    assert_eq!(out, Some(payload));
}
