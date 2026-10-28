use super::*;

/// The checksum one bit at a time, as the format defines it.
fn crc32_bitwise(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

#[test]
fn checksums_match_the_definition() {
    assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    assert_eq!(crc32(b""), 0);
    let data: Vec<u8> = (0..1031u32).map(|i| (i * 7 + i / 13) as u8).collect();
    for len in [1, 7, 8, 9, 63, 64, 1031] {
        assert_eq!(crc32(&data[..len]), crc32_bitwise(&data[..len]), "{len}");
    }
}

#[test]
fn reads_back_what_it_writes() {
    let big: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
    let bytes = write_stored(&[("a.txt", b"hello"), ("images/big", &big)]);
    let zip = ZipArchive::new(&bytes).unwrap();
    assert_eq!(zip.read(zip.find("a.txt").unwrap()).unwrap(), b"hello");
    assert_eq!(zip.read(zip.find("images/big").unwrap()).unwrap(), big);
}
