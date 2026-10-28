const COMMANDS: &[&str] = &[
    "check_permissions",
    "request_permissions",
    "check_registration_status",
    "register_for_remote_notifications",
    "watch_notifications",
    "unwatch_notifications",
    "get_pending_notification",
    "acknowledge_notification",
    "clear_pending_notification",
    "release_notification_cover",
    "configure_recipient",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
