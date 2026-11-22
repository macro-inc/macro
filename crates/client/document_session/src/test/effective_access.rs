use super::*;

#[test]
fn effective_access_downgrade_invalidates_an_earlier_edit_observation_and_regrant_restores() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::None, snapshot);
    let key = text_key(&session);
    assert_eq!(session.effective_access(), Access::Edit);
    for (time_ms, comment, expected) in [(1, true, Access::CommentOnly), (3, false, Access::Read)] {
        session.handle(
            time(time_ms),
            SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
                current: true,
                can_write: false,
                can_comment: comment,
            })),
        );
        assert_eq!(session.effective_access(), expected);
        let output_len = session.last_output().view.len();
        assert_eq!(session.effective_access(), expected);
        assert_eq!(session.last_output().view.len(), output_len);
        let before = session.version();
        let state = session.surface().state().to_json().unwrap();
        let out = session.handle(
            time(time_ms + 1),
            SessionInput::Editor(Input::Command {
                command: Command::InsertText("blocked".into()),
                selection: ViewSelection::KeepModel,
            }),
        );
        assert!(matches!(
            out.view.as_slice(),
            [ViewEffect::Error(SessionError::ReadOnly)]
        ));
        assert_eq!(session.version(), before);
        assert_eq!(session.surface().state().to_json().unwrap(), state);
    }
    session.handle(
        time(5),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: true,
            can_comment: true,
        })),
    );
    assert_eq!(session.effective_access(), Access::Edit);
    let out = session.handle(
        time(6),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("allowed".into()),
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        }),
    );
    assert!(
        !out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert_eq!(
        session.surface().state().view().text_content(key),
        "a😀ballowed"
    );
}
