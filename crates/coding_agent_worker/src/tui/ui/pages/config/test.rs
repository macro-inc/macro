use ratatui::{Terminal, backend::TestBackend};

use crate::config::IdentityScope;
use crate::tui::app::{App, Tab};
use crate::tui::config_form::settings;
use crate::tui::logging::LogBuffer;

#[test]
fn short_config_keeps_selected_settings_and_consent_warnings_visible() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("macrod.toml");
    std::fs::write(&path, include_str!("../../../../../default.macrod.toml")).unwrap();
    let mut app = App::load(&path, LogBuffer::default(), None).unwrap();
    app.tab = Tab::Config;
    app.config.harness.args = vec!["herdr-acp".to_owned()];
    app.config.identity.scope = IdentityScope::Team;
    app.config.identity.allow_permission_bypass = true;
    for height in [20, 24] {
        for (index, setting) in settings(&app.config).iter().enumerate() {
            app.selected_setting = index;
            let mut terminal = Terminal::new(TestBackend::new(80, height)).unwrap();
            terminal
                .draw(|frame| crate::tui::ui::render(frame, &app))
                .unwrap();
            let screen = terminal
                .backend()
                .buffer()
                .content()
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>();
            assert!(
                screen.contains(setting.label()),
                "selected setting is visible"
            );
            assert!(screen.contains("without approval"));
            assert!(screen.contains("Trust your team"));
        }
    }
    let mut terminal = Terminal::new(TestBackend::new(20, 10)).unwrap();
    terminal
        .draw(|frame| crate::tui::ui::render(frame, &app))
        .unwrap();
}
