use std::os::unix::fs::PermissionsExt as _;

use super::*;

#[tokio::test]
async fn a_socket_directory_others_can_enter_is_refused() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o755)).unwrap();

    let listened = listen(&directory.path().join("harnessd.sock"));

    assert_eq!(
        listened.err().map(|error| error.kind()),
        Some(std::io::ErrorKind::PermissionDenied)
    );
    assert!(!directory.path().join("harnessd.sock").exists());
}
