use super::*;

#[test]
fn tile_keys_round_trip() {
    let key = tile_key(70_000, b'p', 12, -3, 4);
    assert_eq!(key, "70000:p:12:-3,4");
    assert_eq!(parse_tile_key(&key), Some((70_000, b'p', 12, -3, 4)));
    assert!(key.starts_with(&tile_prefix(70_000, b'p', 12)));
    assert_eq!(parse_tile_key("nonsense"), None);
}

#[test]
fn tiles_encode_and_decode() {
    let mut samples = vec![0u8; crate::raster::tile_bytes(4)];
    for (i, b) in samples.iter_mut().enumerate() {
        *b = (i * 7 % 251) as u8;
    }
    let text = tile::encode(&samples, 4);
    assert_eq!(tile::decode(&text, 4), Some(samples.clone()));
    assert_eq!(tile::decode(&text, 1), None);
    assert_eq!(tile::decode("not base64!", 4), None);
    assert!(!tile::is_blank(&samples, 4));
    assert!(tile::is_blank(&vec![0; crate::raster::tile_bytes(1)], 1));
}
