//! Coalesce one vectored write without retaining bytes across I/O operations.

/// Bound both scratch space and the size of each browser write.
pub(crate) const MAX_WRITE_BATCH_BYTES: usize = 1024 * 1024;

/// The callback must write the entire batch or return an error. Stop on the first
/// error; the caller retains responsibility for offsets, short writes and flushes.
pub(crate) fn write_batches<'a, E>(
    buffers: impl Iterator<Item = &'a [u8]> + Clone,
    mut write: impl FnMut(&[u8]) -> Result<(), E>,
) -> Result<(), E> {
    let capacity = buffers.clone().fold(0_usize, |size, bytes| {
        size.saturating_add(bytes.len()).min(MAX_WRITE_BATCH_BYTES)
    });
    let mut batch = Vec::with_capacity(capacity);
    for mut bytes in buffers {
        while !bytes.is_empty() {
            // Avoid copying complete batches (including a single large buffer).
            if batch.is_empty() && bytes.len() >= capacity {
                let (chunk, rest) = bytes.split_at(capacity);
                write(chunk)?;
                bytes = rest;
                continue;
            }
            let count = bytes.len().min(capacity - batch.len());
            batch.extend_from_slice(&bytes[..count]);
            bytes = &bytes[count..];
            if batch.len() == capacity {
                write(&batch)?;
                batch.clear();
            }
        }
    }
    if !batch.is_empty() {
        write(&batch)?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
