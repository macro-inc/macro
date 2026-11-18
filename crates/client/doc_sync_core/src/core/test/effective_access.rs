use super::*;

#[test]
fn effective_access_follows_live_authorization_and_revocation() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    assert_eq!(h.core.effective_access(), Access::Edit);
    for (auth, expected) in [
        (
            AuthorizationState {
                current: true,
                can_write: false,
                can_comment: true,
            },
            Access::CommentOnly,
        ),
        (
            AuthorizationState {
                current: true,
                can_write: false,
                can_comment: false,
            },
            Access::Read,
        ),
        (
            AuthorizationState {
                current: true,
                can_write: true,
                can_comment: true,
            },
            Access::Edit,
        ),
        (
            AuthorizationState {
                current: false,
                can_write: true,
                can_comment: true,
            },
            Access::Read,
        ),
    ] {
        h.send(SyncInput::Authorization(auth));
        assert_eq!(h.core.effective_access(), expected);
        let events = h.out.events.len();
        assert_eq!(h.core.effective_access(), expected);
        assert_eq!(h.out.events.len(), events);
    }
    assert_eq!(h.core.phase(), Phase::Stopped);
}

#[test]
fn effective_access_keeps_configured_ceiling_and_is_not_lifecycle_readiness() {
    for ceiling in [Access::Read, Access::CommentOnly, Access::Edit] {
        let mut cfg = config(TransportKind::None, Persistence::Memory);
        cfg.access = ceiling;
        let mut core = SyncCore::new(cfg, now(0)).unwrap();
        let mut doc = Doc::new(7);
        let mut output = SyncOutput::default();
        assert_eq!(core.phase(), Phase::Created);
        assert_eq!(core.effective_access(), ceiling);
        core.handle(
            now(1),
            &mut doc,
            SyncInput::Authorization(AuthorizationState {
                current: true,
                can_write: true,
                can_comment: true,
            }),
            &mut output,
        );
        assert_eq!(core.effective_access(), ceiling);
    }
}
