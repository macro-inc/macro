//! Copy-on-write file clones that work within a filesystem and across ZFS
//! datasets of one pool: `copy_file_range`, which XFS turns into a reflink
//! and ZFS (with block cloning) into a block clone. FICLONE fails across
//! datasets, each being its own mount.
//!
//! A block clone walks every block of the file in the kernel: seconds for a
//! 68 GiB `/home` template on a busy pool. Both functions run it on the
//! blocking pool, never on an async worker.

use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

/// Clone `source` into a new `target` (replaced if present).
pub async fn clone_file(source: &Path, target: &Path) -> std::io::Result<()> {
    off_the_runtime(source, target, clone_blocking).await
}

/// Move `source` to `target`, also across datasets: clone, then delete.
pub async fn move_file(source: &Path, target: &Path) -> std::io::Result<()> {
    off_the_runtime(source, target, |source, target| {
        clone_blocking(source, target)?;
        std::fs::remove_file(source)
    })
    .await
}

async fn off_the_runtime(
    source: &Path,
    target: &Path,
    work: fn(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let (source, target): (PathBuf, PathBuf) = (source.to_owned(), target.to_owned());
    let span = tracing::Span::current();
    tokio::task::spawn_blocking(move || span.in_scope(|| work(&source, &target)))
        .await
        .map_err(std::io::Error::other)?
}

fn clone_blocking(source: &Path, target: &Path) -> std::io::Result<()> {
    let input = std::fs::File::open(source)?;
    let output = std::fs::File::create(target)?;
    let length = input.metadata()?.len();
    let mut input_offset: u64 = 0;
    let mut output_offset: u64 = 0;
    while input_offset < length {
        let remaining = usize::try_from(length - input_offset).unwrap_or(usize::MAX);
        let copied = rustix::fs::copy_file_range(
            &input,
            Some(&mut input_offset),
            &output,
            Some(&mut output_offset),
            remaining,
        )?;
        if copied == 0 {
            break;
        }
    }
    // A trailing hole is not copied; the file keeps its size.
    output.set_len(length)?;
    output.sync_all()
}
