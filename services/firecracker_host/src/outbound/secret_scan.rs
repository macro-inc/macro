//! Every customer can read a golden's whole memory and rootfs: a page the
//! guest never wrote reads as the golden's. So a golden that holds a secret
//! the golden boot made (host keys, an enrollment, a token) is not
//! published.
//!
//! Key material that is in the image itself is not a golden secret: every
//! computer of that image gets the image anyway, and images carry public
//! test fixtures (store paths of packages' test suites, which the golden's
//! page cache holds after its prewarm). So an occurrence counts only when its
//! fragment is not in the image's rootfs. A fragment is the bytes from the
//! pattern to the end of its 4 KiB page: guest memory holds file pages at the
//! same in-page offsets as the file, but not next to each other.

use std::collections::HashSet;
use std::io::Read;
use std::os::unix::fs::FileExt;
use std::path::Path;

use memchr::memmem;

#[cfg(test)]
mod test;

/// What a published golden must not contain: real key material, not the
/// literal headers (programs that parse keys carry those): a PEM header
/// followed by the start of its base64 body.
/// (PEM headers are split so this file does not trip secret scanners.)
pub const SECRET_PATTERNS: [&str; 6] = [
    // The enrollment's one-time secret, as its JSON carries it.
    "\"device_secret\":\"",
    // PKCS#8 and PKCS#1 bodies start with a DER SEQUENCE: base64 `MI`.
    concat!("-----BEGIN ", "PRIVATE KEY", "-----\nMI"),
    concat!("-----BEGIN ", "RSA PRIVATE KEY", "-----\nMI"),
    // SEC1 EC keys: `MH` (P-256) or `MI` (P-384, P-521).
    concat!("-----BEGIN ", "EC PRIVATE KEY", "-----\nM"),
    // `openssh-key-v1` in base64.
    concat!(
        "-----BEGIN ",
        "OPENSSH PRIVATE KEY",
        "-----\nb3BlbnNzaC1rZXktdjE"
    ),
    // Macro API keys (`mak_…`) in an environment file.
    "MACRO_API_KEY=\"mak_",
];

const CHUNK_BYTES: usize = 8 * 1024 * 1024;
const PAGE_BYTES: u64 = 4096;

/// A secret pattern found in a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    /// Which pattern.
    pub pattern: &'static str,
    /// Byte offset of its first occurrence.
    pub offset: u64,
}

/// Every fragment of key material in `image` (its rootfs): what a golden of
/// it may hold without having made a secret.
pub fn image_fragments(image: &Path) -> std::io::Result<HashSet<Vec<u8>>> {
    let file = std::fs::File::open(image)?;
    let mut fragments = HashSet::new();
    for_each_occurrence(&file, |offset, _| {
        fragments.insert(fragment(&file, offset)?);
        Ok(true)
    })?;
    Ok(fragments)
}

/// The first secret pattern in `path` whose fragment is not in
/// `public` (see [`image_fragments`]).
pub fn scan(path: &Path, public: &HashSet<Vec<u8>>) -> std::io::Result<Option<Finding>> {
    let file = std::fs::File::open(path)?;
    let mut finding = None;
    for_each_occurrence(&file, |offset, pattern| {
        if public.contains(&fragment(&file, offset)?) {
            return Ok(true);
        }
        finding = Some(Finding { pattern, offset });
        Ok(false)
    })?;
    Ok(finding)
}

/// The bytes from `offset` to the end of its page.
fn fragment(file: &std::fs::File, offset: u64) -> std::io::Result<Vec<u8>> {
    let length = PAGE_BYTES - offset % PAGE_BYTES;
    let mut bytes = vec![0u8; usize::try_from(length).unwrap_or(4096)];
    let read = file.read_at(&mut bytes, offset)?;
    bytes.truncate(read);
    Ok(bytes)
}

/// Call `visit` with every occurrence of a pattern, in file order, until it
/// returns false. Chunks overlap by the longest pattern, so a match across a
/// boundary is found once.
fn for_each_occurrence(
    mut file: &std::fs::File,
    mut visit: impl FnMut(u64, &'static str) -> std::io::Result<bool>,
) -> std::io::Result<()> {
    let finders: Vec<_> = SECRET_PATTERNS
        .iter()
        .map(|pattern| (*pattern, memmem::Finder::new(pattern.as_bytes())))
        .collect();
    let overlap = SECRET_PATTERNS
        .iter()
        .map(|pattern| pattern.len())
        .max()
        .unwrap_or(1)
        - 1;

    let mut buffer = vec![0u8; CHUNK_BYTES + overlap];
    // Bytes at the front of `buffer` carried over from the previous chunk.
    let mut carried = 0;
    // File offset of `buffer[0]`.
    let mut base: u64 = 0;
    loop {
        let read = file.read(&mut buffer[carried..])?;
        if read == 0 {
            return Ok(());
        }
        let filled = carried + read;
        let window = &buffer[..filled];
        let mut occurrences: Vec<(usize, &'static str)> = finders
            .iter()
            .flat_map(|(pattern, finder)| finder.find_iter(window).map(move |at| (at, *pattern)))
            // Matches wholly inside the carried bytes were visited last round.
            .filter(|(at, pattern)| at + pattern.len() > carried)
            .collect();
        occurrences.sort_unstable();
        for (at, pattern) in occurrences {
            if !visit(base + at as u64, pattern)? {
                return Ok(());
            }
        }
        let keep = overlap.min(filled);
        buffer.copy_within(filled - keep..filled, 0);
        base += (filled - keep) as u64;
        carried = keep;
    }
}
