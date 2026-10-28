use super::*;
use crate::write_batch::MAX_WRITE_BATCH_BYTES;

fn calls() -> usize {
    REGISTRY.with(|registry| registry.borrow().faults.write_calls)
}

fn clear(file: &Arc<dyn File>) {
    let completion = truncate_completion();
    drop(file.truncate(0, completion.completion.clone()).unwrap());
    assert_completion(&completion, Ok(0));
}

fn read_bytes(file: &Arc<dyn File>, pos: u64, expected: &[u8]) {
    let bytes = Arc::new(Buffer::new(vec![0; expected.len()]));
    let completion = read_completion(bytes.clone());
    drop(file.pread(pos, completion.completion.clone()).unwrap());
    assert_completion(&completion, Ok(expected.len() as i32));
    assert_eq!(bytes.as_slice(), expected);
}

fn write(file: &Arc<dyn File>, pos: u64, buffers: Vec<Vec<u8>>) -> TrackedCompletion {
    let completion = write_completion();
    drop(
        file.pwritev(
            pos,
            buffers
                .into_iter()
                .map(|bytes| Arc::new(Buffer::new(bytes)))
                .collect(),
            completion.completion.clone(),
        )
        .unwrap(),
    );
    completion
}

pub(super) fn check(file: &Arc<dyn File>) {
    clear(file);
    for buffers in [vec![], vec![vec![], vec![]]] {
        let before = calls();
        let completion = write(file, u64::MAX, buffers);
        assert_completion(&completion, Ok(0));
        assert_eq!(calls(), before);
        assert_eq!(file.size().unwrap(), 0);
    }

    for buffers in [
        vec![
            vec![1; MAX_WRITE_BATCH_BYTES - 7],
            vec![],
            vec![2; 19],
            vec![3; MAX_WRITE_BATCH_BYTES + 13],
        ],
        (0..774)
            .map(|index| vec![(index % 251) as u8; 4096 + 24])
            .collect(),
    ] {
        clear(file);
        let expected = buffers.concat();
        let before = calls();
        let completion = write(file, 11, buffers);
        assert_completion(&completion, Ok(expected.len() as i32));
        assert_eq!(
            calls() - before,
            expected.len().div_ceil(MAX_WRITE_BATCH_BYTES),
            "bounded coalesced browser writes"
        );
        assert_eq!(file.size().unwrap(), 11 + expected.len() as u64);
        read_bytes(file, 11, &expected);
    }

    clear(file);
    REGISTRY.with(|registry| registry.borrow_mut().faults.max_write_chunk = Some(2));
    let before = calls();
    let completion = write(
        file,
        0,
        vec![b"a".to_vec(), b"bc".to_vec(), b"def".to_vec()],
    );
    assert_completion(&completion, Ok(6));
    assert_eq!(
        calls() - before,
        3,
        "short writes retry across input boundaries"
    );
    read_bytes(file, 0, b"abcdef");

    let injected = CompletionError::IOError(ErrorKind::StorageFull, "batched write failure");
    clear(file);
    REGISTRY.with(|registry| {
        registry.borrow_mut().faults.write_error_after_chunks = Some((1, injected));
    });
    let before = calls();
    let completion = write(
        file,
        0,
        vec![b"a".to_vec(), b"bc".to_vec(), b"def".to_vec()],
    );
    assert_completion(&completion, Err(injected));
    assert_eq!(calls() - before, 2);
    assert_eq!(file.size().unwrap(), 2);
    read_bytes(file, 0, b"ab");

    clear(file);
    REGISTRY.with(|registry| registry.borrow_mut().faults.max_write_chunk = Some(0));
    let completion = write(file, 0, vec![b"a".to_vec(), b"b".to_vec()]);
    assert_completion(&completion, Err(CompletionError::ShortWrite));
    assert_eq!(file.size().unwrap(), 0);

    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        registry.faults.max_write_chunk = None;
        registry.faults.write_error_after_chunks = Some((1, injected));
    });
    let buffers = vec![
        vec![1; MAX_WRITE_BATCH_BYTES - 1],
        vec![2; MAX_WRITE_BATCH_BYTES + 9],
        vec![3; 4],
    ];
    let expected = buffers.concat();
    let before = calls();
    let completion = write(file, 0, buffers);
    assert_completion(&completion, Err(injected));
    assert_eq!(calls() - before, 2, "no writes after a failed batch");
    assert_eq!(file.size().unwrap(), MAX_WRITE_BATCH_BYTES as u64);
    read_bytes(file, 0, &expected[..MAX_WRITE_BATCH_BYTES]);
    clear(file);
}
