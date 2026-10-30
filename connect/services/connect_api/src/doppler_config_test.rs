use super::*;

#[test]
fn required_keys_follow_live_own_apps() {
    let apps = all_apps().unwrap();
    assert_eq!(
        required_keys(apps),
        ["DATABASE_URL", "CONNECT_KMS_KEY_ID", "CONNECT_PUBLIC_URL"]
    );

    let mut github = apps
        .iter()
        .find(|app| app.id.as_str() == "github")
        .unwrap()
        .clone();
    github.status = Status::Live;
    assert_eq!(
        required_keys(&[github]),
        [
            "DATABASE_URL",
            "CONNECT_KMS_KEY_ID",
            "CONNECT_PUBLIC_URL",
            "GITHUB_CLIENT_ID",
            "GITHUB_CLIENT_SECRET",
        ]
    );
}
