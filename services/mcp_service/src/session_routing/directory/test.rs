use super::*;

#[test]
fn responses_route_only_to_the_owning_user_and_process() {
    let owner = Owner {
        user: "alice".into(),
        process: "process-a".into(),
        address: "127.0.0.1:8001".parse().unwrap(),
    };
    assert_eq!(
        route(Some(&owner), "alice", "process-a", None),
        Route::Local
    );
    assert_eq!(
        route(Some(&owner), "alice", "process-b", None),
        Route::Forward(owner.address)
    );
    assert_eq!(
        route(Some(&owner), "bob", "process-a", None),
        Route::Forbidden
    );
    assert_eq!(
        route(Some(&owner), "bob", "process-b", None),
        Route::Forbidden
    );
    assert_eq!(
        route(Some(&owner), "alice", "process-a", Some("process-a")),
        Route::Local
    );
    // A replacement process at the same address must not restore pending calls.
    assert_eq!(
        route(Some(&owner), "alice", "replacement", Some("process-a")),
        Route::Expired
    );
    assert_eq!(route(None, "alice", "process-b", None), Route::Expired);
}
