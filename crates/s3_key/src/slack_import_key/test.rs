use super::*;

const TEAM: &str = "01980000-0000-7000-8000-000000000001";
const JOB: &str = "01980000-0000-7000-8000-000000000002";

#[test]
fn canonical_keys_round_trip() {
    let team = TEAM.parse().unwrap();
    let job = JOB.parse().unwrap();
    let users = SlackImportKey::users(team, job).unwrap();
    assert_eq!(
        users.to_key(),
        format!("slack-import/{TEAM}/{JOB}/users.json")
    );
    for key in [
        users,
        SlackImportKey::conversation_part(team, job, "C123", 0).unwrap(),
        SlackImportKey::conversation_part(team, job, "D123", u32::MAX).unwrap(),
    ] {
        assert_eq!(key.to_string().parse::<SlackImportKey>().unwrap(), key);
        assert_eq!(key.team(), team);
        assert_eq!(key.job(), job);
    }
}

#[test]
fn rejects_unsafe_and_noncanonical_keys() {
    let prefix = format!("slack-import/{TEAM}/{JOB}");
    for suffix in [
        "",
        "users.json/",
        "users.json/extra",
        "org_users.json",
        "../users.json",
        "C123/00.ndjson",
        "C123/+1.ndjson",
        "C123/-1.ndjson",
        "C123/4294967296.ndjson",
        "C123/1.NDJSON",
        "C123%2f/1.ndjson",
        "C123\\/1.ndjson",
        "C123\n/1.ndjson",
        "c123/1.ndjson",
        "C/1.ndjson",
        "/users.json",
        "U123/1.ndjson",
    ] {
        assert!(
            format!("{prefix}/{suffix}")
                .parse::<SlackImportKey>()
                .is_err(),
            "{suffix:?}"
        );
    }
    for value in [
        format!("/{prefix}/users.json"),
        format!("s3://bucket/{prefix}/users.json"),
        format!("slack-import/{}/{JOB}/users.json", TEAM.replace('-', "")),
        format!("slack-import/01980000-ABCD-7000-8000-000000000001/{JOB}/users.json"),
        format!("slack-import/{}/{JOB}/users.json", Uuid::nil()),
    ] {
        assert!(value.parse::<SlackImportKey>().is_err());
    }
    for id in ["..", "C1/..", "C%31", "C 1", "Cé", ""] {
        assert!(
            SlackImportKey::conversation_part(TEAM.parse().unwrap(), JOB.parse().unwrap(), id, 0)
                .is_err()
        );
    }
}
