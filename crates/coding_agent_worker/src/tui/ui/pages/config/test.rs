use harness_id::HarnessId;
use harnesses::domain::models::{Harness, HarnessOwner};
use ratatui::{Terminal, backend::TestBackend};

use crate::tui::app::{App, Tab};
use crate::tui::config_form::settings;
use crate::tui::logging::LogBuffer;

fn screen(app: &App, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| crate::tui::ui::render(frame, app))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>()
}

#[test]
fn short_config_keeps_selected_settings_and_web_owned_values_visible() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("macrod.toml");
    std::fs::write(&path, include_str!("../../../../../default.macrod.toml")).unwrap();
    let mut app = App::load(&path, LogBuffer::default(), None).unwrap();
    app.tab = Tab::Config;
    app.config.harness.args = vec!["herdr-acp".to_owned()];
    app.snapshot.harness = Some(Harness {
        allow_permission_bypass: true,
        id: HarnessId::TEST_A,
        kind: "macrod".to_owned(),
        name: "Desk".to_owned(),
        owner: HarnessOwner::Team {
            team_id: uuid::Uuid::nil(),
        },
        created_by: "macro|user".to_owned(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        connected: true,
        last_connected_at: None,
    });
    for height in [22, 24] {
        for (index, setting) in settings(&app.config).iter().enumerate() {
            app.selected_setting = index;
            let screen = screen(&app, 100, height);
            assert!(
                screen.contains(setting.label()),
                "selected setting is visible"
            );
            assert!(screen.contains("without approval"));
            assert!(screen.contains("teammates can command agents"));
            assert!(screen.contains("https://macro.com/app/settings/harness"));
        }
    }
    screen(&app, 20, 10);
}

#[test]
fn unpaired_config_points_at_the_web_settings() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("macrod.toml");
    std::fs::write(&path, include_str!("../../../../../default.macrod.toml")).unwrap();
    let mut app = App::load(&path, LogBuffer::default(), None).unwrap();
    app.tab = Tab::Config;

    let screen = screen(&app, 100, 24);
    assert!(screen.contains("paired and reachable"));
    assert!(screen.contains("https://macro.com/app/settings/harness"));
    assert!(!screen.contains("without approval"));
}
