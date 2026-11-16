use std::path::Path;

use super::Scratch;

fn entries(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

#[test]
fn a_job_folder_is_removed_with_its_contents_when_the_job_ends() {
    let root = tempfile::tempdir().unwrap();
    let scratch = Scratch::reset(root.path()).unwrap();

    let job = scratch.create_job().unwrap();
    std::fs::write(job.path().join("IN.docx"), b"input").unwrap();
    std::fs::create_dir_all(job.path().join(".config/libreoffice/4")).unwrap();
    std::fs::write(job.path().join(".config/libreoffice/4/profile"), b"profile").unwrap();
    let path = job.path().to_path_buf();
    assert!(path.starts_with(root.path().join("jobs")));

    drop(job);

    assert!(!path.exists());
    assert_eq!(entries(&root.path().join("jobs")), Vec::<String>::new());
}

#[test]
fn a_job_folder_is_removed_when_the_job_panics() {
    let root = tempfile::tempdir().unwrap();
    let scratch = Scratch::reset(root.path()).unwrap();

    let panicked = std::panic::catch_unwind(|| {
        let job = scratch.create_job().unwrap();
        std::fs::write(job.path().join("IN.docx"), b"input").unwrap();
        panic!("conversion panicked");
    });

    assert!(panicked.is_err());
    assert_eq!(entries(&root.path().join("jobs")), Vec::<String>::new());
}

#[test]
fn attempts_of_the_same_job_get_separate_folders() {
    let root = tempfile::tempdir().unwrap();
    let scratch = Scratch::reset(root.path()).unwrap();

    let first = scratch.create_job().unwrap();
    let second = scratch.create_job().unwrap();
    assert_ne!(first.path(), second.path());

    drop(first);

    assert!(second.path().is_dir());
}

#[test]
fn startup_removes_what_a_killed_process_left_behind() {
    let root = tempfile::tempdir().unwrap();
    let scratch = Scratch::reset(root.path()).unwrap();
    let job = scratch.create_job().unwrap();
    std::fs::write(job.path().join("IN.docx"), b"input").unwrap();
    std::fs::write(scratch.cache().join("fonts"), b"cache").unwrap();
    std::fs::write(root.path().join("stray"), b"stray").unwrap();
    // A killed process never drops its job folders.
    std::mem::forget(job);
    assert_eq!(entries(&root.path().join("jobs")).len(), 1);

    let scratch = Scratch::reset(root.path()).unwrap();

    assert_eq!(entries(&root.path().join("jobs")), Vec::<String>::new());
    assert_eq!(entries(scratch.cache()), Vec::<String>::new());
    let mut left = entries(root.path());
    left.sort();
    assert_eq!(left, ["cache", "jobs"]);
    scratch.create_job().unwrap();
}

#[test]
fn startup_creates_a_scratch_space_that_does_not_exist_yet() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("convert_service");

    let scratch = Scratch::reset(&root).unwrap();

    assert_eq!(scratch.root(), root);
    assert!(scratch.create_job().unwrap().path().is_dir());
}
