//! Copy-on-write file clones that work within a filesystem and across ZFS
//! datasets of one pool: `copy_file_range`, which XFS turns into a reflink
//! and ZFS (with block cloning) into a block clone. FICLONE fails across
//! datasets, each being its own mount.

use std::path::Path;

/// Clone `source` into a new `target` (replaced if present).
pub fn clone_file(source: &Path, target: &Path) -> std::io::Result<()> {
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

/// Move `source` to `target`, also across datasets: clone, then delete.
pub fn move_file(source: &Path, target: &Path) -> std::io::Result<()> {
    clone_file(source, target)?;
    std::fs::remove_file(source)
}
