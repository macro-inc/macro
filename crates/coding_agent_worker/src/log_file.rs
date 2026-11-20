//! The append-only files macrod keeps for its operator: private to the user
//! (a 0700 directory, a 0600 file) and size-capped by rotating to `<file>.1`,
//! which replaces an older one.

use std::io::Write as _;
use std::path::Path;

/// Append `bytes` to the file at `path` in one write, first rotating it when it
/// has reached `max_bytes`. One write per call, so concurrent writers
/// interleave whole lines.
pub fn append(path: &Path, max_bytes: u64, bytes: &[u8]) -> std::io::Result<()> {
    let directory = path.parent().unwrap_or(Path::new("."));
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt as _;
        builder.mode(0o700);
    }
    builder.create(directory)?;
    if std::fs::metadata(path).is_ok_and(|metadata| metadata.len() >= max_bytes) {
        let mut rotated = path.as_os_str().to_owned();
        rotated.push(".1");
        std::fs::rename(path, rotated)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)
}
