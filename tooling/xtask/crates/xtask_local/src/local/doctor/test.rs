use super::*;

/// A checkout with one worker's wrangler state (two dirs and a file), owned by
/// the test user.
fn checkout_with_wrangler_state() -> (std::path::PathBuf, u32, u32) {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("macro-doctor-ownership-{unique}"));
    let state = root.join("services/analytics-proxy/.wrangler/state");
    std::fs::create_dir_all(&state).unwrap();
    std::fs::write(state.join("db.sqlite"), "").unwrap();
    let meta = std::fs::metadata(&root).unwrap();
    (root, meta.uid(), meta.gid())
}

#[test]
fn stack_start_passes_when_the_checkout_owner_owns_container_written_files() {
    let (root, uid, gid) = checkout_with_wrangler_state();
    let status = checkout_ownership(&root, uid, gid);
    assert!(matches!(status, Status::Ok(_)));
    assert!(require_checkout_ownership(status).is_ok());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn stack_start_fails_with_the_chown_command_when_another_user_owns_them() {
    let (root, uid, gid) = checkout_with_wrangler_state();
    let other = uid + 1;
    let Status::Fail { msg, hint } = checkout_ownership(&root, other, gid) else {
        panic!("expected the ownership check to fail");
    };
    assert_eq!(
        msg,
        "3 file(s) not owned by the checkout owner under services/analytics-proxy/.wrangler"
    );
    let chown = format!(
        "from the repository root: sudo chown -R {other}:{gid} services/analytics-proxy/.wrangler"
    );
    assert_eq!(hint.as_deref(), Some(chown.as_str()));

    let err = require_checkout_ownership(checkout_ownership(&root, other, gid))
        .unwrap_err()
        .to_string();
    assert!(err.contains(&msg), "{err}");
    assert!(err.contains(&chown), "{err}");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn stack_start_passes_when_no_container_has_written_yet() {
    let (root, uid, gid) = checkout_with_wrangler_state();
    std::fs::remove_dir_all(root.join("services")).unwrap();
    assert!(matches!(
        checkout_ownership(&root, uid + 1, gid),
        Status::Ok(_)
    ));
    std::fs::remove_dir_all(&root).unwrap();
}
