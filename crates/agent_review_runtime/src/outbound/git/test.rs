use super::*;

#[test]
fn bounds_workspace_reads_even_if_the_file_grows_after_metadata() {
    let mut source = std::io::repeat(b'a').take(MAX_FILE_BYTES * 2);
    assert!(matches!(
        read_contents(&mut source).unwrap(),
        Contents::TooLarge
    ));
    assert_eq!(source.limit(), MAX_FILE_BYTES - 1);
}

#[test]
fn accepts_workspace_contents_at_the_exact_limit() {
    let source = std::io::repeat(b'a').take(MAX_FILE_BYTES);
    let Contents::Bytes(bytes) = read_contents(source).unwrap() else {
        panic!("an exact-limit file must remain readable");
    };
    assert_eq!(bytes.len() as u64, MAX_FILE_BYTES);
    assert!(bytes.iter().all(|byte| *byte == b'a'));
}

#[test]
fn orders_like_the_tree() {
    let mut paths = vec![
        "README.md",
        "src/lib.rs",
        "Cargo.lock",
        "src/a/b.rs",
        "web/x.ts",
    ];
    paths.sort_by(|a, b| tree_order(a, b));
    assert_eq!(
        paths,
        vec![
            "src/a/b.rs",
            "src/lib.rs",
            "web/x.ts",
            "Cargo.lock",
            "README.md"
        ]
    );
}

#[test]
fn parses_raw_diffs() {
    let (a, b, z) = ("a".repeat(40), "b".repeat(40), "0".repeat(40));
    let out = format!(
        ":100644 100644 {a} {b} M\0src/a b.rs\0:100644 100644 {a} {b} R087\0old.rs\0new\nline.rs\0\
             :100644 000000 {a} {z} D\0gone.rs\0:000000 100644 {z} {z} A\0added.rs\0:160000 160000 {a} {b} M\0sub\0"
    );
    let e = parse_raw(&out);
    assert_eq!(e.len(), 5);
    assert_eq!(
        (
            e[0].path.as_str(),
            e[0].old_blob.as_deref(),
            e[0].new_blob.as_deref()
        ),
        ("src/a b.rs", Some(a.as_str()), Some(b.as_str()))
    );
    assert_eq!(e[1].status, FileStatus::Renamed);
    assert_eq!(
        (e[1].old_path.as_deref(), e[1].path.as_str()),
        (Some("old.rs"), "new\nline.rs")
    );
    assert_eq!(
        (e[2].status, e[2].new_blob.as_deref()),
        (FileStatus::Deleted, None)
    );
    assert_eq!(
        (e[3].status, e[3].new_blob.as_deref()),
        (FileStatus::Added, None),
        "the working tree side"
    );
    assert_eq!(e[4].new_blob, None, "submodules have no contents");
}
