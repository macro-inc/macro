use std::collections::HashSet;
use std::io::Write;

use super::{CHUNK_BYTES, Finding, image_fragments, scan};

const KEY: &[u8] = concat!(
    "-----BEGIN ",
    "OPENSSH PRIVATE KEY",
    "-----\nb3BlbnNzaC1rZXktdjEAAAAA\n"
)
.as_bytes();

fn file_with(parts: &[&[u8]]) -> tempfile::NamedTempFile {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    for part in parts {
        file.write_all(part).unwrap();
    }
    file
}

#[test]
fn a_secret_across_a_chunk_boundary_is_found_at_its_offset() {
    let start = CHUNK_BYTES - 10;
    let file = file_with(&[
        &vec![0u8; start],
        b"{\"device_secret\":\"x\"}",
        &[0u8; 4096],
    ]);

    assert_eq!(
        scan(file.path(), &HashSet::new()).unwrap(),
        Some(Finding {
            pattern: "\"device_secret\":\"",
            offset: start as u64 + 1,
        })
    );
}

#[test]
fn certificates_are_not_secrets() {
    let file = file_with(&[b"-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"]);

    assert_eq!(scan(file.path(), &HashSet::new()).unwrap(), None);
}

#[test]
fn a_key_the_image_ships_at_the_same_page_offset_is_not_a_golden_secret() {
    // The image has the key 100 bytes into a page; the golden's memory
    // holds that page somewhere else, at the same in-page offset.
    let image = file_with(&[&[7u8; 4096 * 3 + 100], KEY, &[0u8; 4096]]);
    let memory = file_with(&[&[1u8; 4096 * 40 + 100], KEY, &[0u8; 4096]]);
    let public = image_fragments(image.path()).unwrap();

    assert_eq!(scan(memory.path(), &public).unwrap(), None);
}

#[test]
fn a_key_the_golden_boot_made_is_refused_even_beside_shipped_ones() {
    let image = file_with(&[&[7u8; 100], KEY, &[0u8; 4096]]);
    let mut made = KEY.to_vec();
    made.extend_from_slice(b"AAAAgeneratedAtBootAAAA\n");
    let memory = file_with(&[
        &[1u8; 100],
        KEY,
        &[0u8; 4096 - 100 - KEY.len()],
        &[2u8; 50],
        &made,
    ]);
    let public = image_fragments(image.path()).unwrap();

    let finding = scan(memory.path(), &public).unwrap().unwrap();
    assert_eq!(finding.offset, 4096 + 50);
}

#[test]
fn a_header_without_a_key_body_is_code_not_a_key() {
    let file = file_with(&[concat!(
        "if (line == \"-----BEGIN ",
        "OPENSSH PRIVATE KEY",
        "-----\") {"
    )
    .as_bytes()]);

    assert_eq!(scan(file.path(), &HashSet::new()).unwrap(), None);
}
