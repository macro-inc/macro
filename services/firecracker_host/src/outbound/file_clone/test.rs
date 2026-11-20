use std::sync::mpsc;
use std::time::Duration;

use super::clone_file;

/// A FIFO source holds the clone in `open` until a writer comes. The writer
/// comes only once another task on the same single-threaded runtime has
/// run: a clone on the async worker would hold the runtime, that task would
/// never run, and the writer would give up.
#[tokio::test(flavor = "current_thread")]
async fn a_clone_leaves_the_runtime_free_while_it_blocks() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source");
    let target = directory.path().join("target");
    rustix::fs::mknodat(
        rustix::fs::CWD,
        &source,
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::from_raw_mode(0o600),
        0,
    )
    .unwrap();

    let (other_task_ran, ran) = mpsc::channel::<()>();
    let writer = std::thread::spawn({
        let source = source.clone();
        move || {
            let freed = ran.recv_timeout(Duration::from_secs(10)).is_ok();
            // Unblock the clone either way, so a failure fails, not hangs.
            drop(
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(&source)
                    .unwrap(),
            );
            freed
        }
    });
    let other = tokio::spawn(async move { other_task_ran.send(()).unwrap() });

    clone_file(&source, &target).await.unwrap();
    other.await.unwrap();
    assert!(
        writer.join().unwrap(),
        "the clone held the runtime: no other task ran while it waited"
    );
}
