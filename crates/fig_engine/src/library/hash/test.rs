use super::*;

#[test]
fn sha1_matches_known_digests() {
    assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    assert_eq!(
        hex(&sha1(b"The quick brown fox jumps over the lazy dog")),
        "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12"
    );
}

#[test]
fn numbers_take_file_precision() {
    assert_eq!(
        at_file_precision("Affine { m00: 0.1, m02: 10.100000381469727, x2: 3 }"),
        "Affine { m00: 0.1, m02: 10.1, x2: 3 }"
    );
    assert_eq!(at_file_precision("v: -2.5e-3"), "v: -0.0025");
}
