use super::*;

fn assert_batches(buffers: &[Vec<u8>]) -> Vec<usize> {
    let expected = buffers.concat();
    let mut actual = Vec::new();
    let mut lengths = Vec::new();
    write_batches(buffers.iter().map(Vec::as_slice), |bytes| {
        assert!(!bytes.is_empty());
        assert!(bytes.len() <= MAX_WRITE_BATCH_BYTES);
        actual.extend_from_slice(bytes);
        lengths.push(bytes.len());
        Ok::<_, ()>(())
    })
    .unwrap();
    assert_eq!(actual, expected);
    assert_eq!(
        lengths.len(),
        expected.len().div_ceil(MAX_WRITE_BATCH_BYTES)
    );
    lengths
}

#[test]
fn empty_vectors_do_not_write() {
    assert!(assert_batches(&[]).is_empty());
    assert!(assert_batches(&[vec![], vec![]]).is_empty());
}

#[test]
fn small_buffers_and_empty_entries_preserve_order_in_one_write() {
    assert_eq!(
        assert_batches(&[b"12".to_vec(), vec![], b"345".to_vec(), vec![]]),
        [5]
    );
    assert_eq!(assert_batches(&[b"single buffer".to_vec()]), [13]);
}

#[test]
fn hundreds_of_wal_frames_use_bounded_batches_not_one_write_per_frame() {
    let buffers = (0..774)
        .map(|index| vec![(index % 251) as u8; 4096 + 24])
        .collect::<Vec<_>>();
    let lengths = assert_batches(&buffers);
    assert_eq!(lengths.len(), 4);
    assert_eq!(lengths[..3], [MAX_WRITE_BATCH_BYTES; 3]);
}

#[test]
fn batches_split_inside_buffers_and_at_exact_boundaries() {
    for prefix in [0, 1, MAX_WRITE_BATCH_BYTES - 1, MAX_WRITE_BATCH_BYTES] {
        for middle in [0, 1, MAX_WRITE_BATCH_BYTES, MAX_WRITE_BATCH_BYTES * 2 + 1] {
            assert_batches(&[
                vec![1; prefix],
                vec![],
                vec![2; middle],
                vec![3; MAX_WRITE_BATCH_BYTES + 17],
            ]);
        }
    }
}

#[test]
fn errors_stop_later_batches_and_preserve_the_written_prefix() {
    for fail_at in 0..3 {
        let buffers = vec![vec![1; MAX_WRITE_BATCH_BYTES + 1]; 2];
        let mut calls = 0;
        let mut written = Vec::new();
        let result = write_batches(buffers.iter().map(Vec::as_slice), |bytes| {
            let call = calls;
            calls += 1;
            if call == fail_at {
                return Err("storage full");
            }
            written.extend_from_slice(bytes);
            Ok(())
        });
        assert_eq!(result, Err("storage full"));
        assert_eq!(calls, fail_at + 1);
        assert_eq!(written, vec![1; fail_at * MAX_WRITE_BATCH_BYTES]);
    }
}
