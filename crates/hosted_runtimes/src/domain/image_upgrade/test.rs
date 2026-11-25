use chrono::{Duration, TimeZone, Utc};
use uuid::Uuid;

use super::*;

#[test]
fn an_image_version_is_a_name_a_date_and_a_letter() {
    for version in ["macro-box/2026-11-24a", "macro-box-agent/2027-01-02z"] {
        assert_eq!(ImageVersion::try_new(version).unwrap().as_str(), version);
    }
    for version in [
        "macro-box/latest",
        "main",
        "macro-box/main",
        "macro-box/2026-11-24",
        "macro-box/2026-11-24ab",
        "macro-box/2026-11-24A",
        "Macro-box/2026-11-24a",
        "macro-box/26-11-24a",
        "macro-box/2026-11-24a/x",
        "../2026-11-24a",
    ] {
        assert!(ImageVersion::try_new(version).is_err(), "{version}");
    }
}

fn file(name: ImageFileName) -> ImageFile {
    ImageFile {
        name,
        sha256: Sha256::try_new(&"a".repeat(64)).unwrap(),
        bytes: 1,
    }
}

#[test]
fn an_image_has_its_three_files_once_each_whatever_the_order() {
    let files = ImageFiles::try_new(vec![
        file(ImageFileName::BootArgs),
        file(ImageFileName::Vmlinux),
        file(ImageFileName::RootfsExt4),
    ])
    .unwrap();
    assert!(files.held_by(&[
        file(ImageFileName::RootfsExt4),
        file(ImageFileName::BootArgs),
        file(ImageFileName::Vmlinux),
    ]));
    let mut other = file(ImageFileName::BootArgs);
    other.bytes = 2;
    assert!(!files.held_by(&[
        file(ImageFileName::RootfsExt4),
        other,
        file(ImageFileName::Vmlinux),
    ]));
    assert!(
        ImageFiles::try_new(vec![
            file(ImageFileName::Vmlinux),
            file(ImageFileName::Vmlinux),
            file(ImageFileName::BootArgs),
        ])
        .is_err()
    );
}

#[test]
fn only_https_sources_and_never_printed() {
    assert!(SourceUrl::try_new("http://bucket/x").is_none());
    let url = SourceUrl::try_new("https://bucket/x?X-Amz-Signature=secret").unwrap();
    assert!(!format!("{url:?}").contains("secret"));
}

fn request(computers: Vec<ComputerId>) -> NewImageUpgrade {
    NewImageUpgrade {
        image: ImageVersion::try_new("macro-box/2026-11-24a").unwrap(),
        sources: [
            ImageFileName::Vmlinux,
            ImageFileName::RootfsExt4,
            ImageFileName::BootArgs,
        ]
        .into_iter()
        .map(|name| ImageSource {
            file: file(name),
            url: SourceUrl::try_new("https://bucket/x").unwrap(),
        })
        .collect(),
        computers,
        batch_size: 1,
        idle_wait: Duration::minutes(30),
        reconnect_timeout: Duration::minutes(10),
        created_by: "run".to_owned(),
    }
}

fn computer(n: u128) -> ComputerId {
    ComputerId::new_from_uuid(Uuid::from_u128(n))
}

#[test]
fn a_request_names_distinct_computers_and_bounded_batches_and_waits() {
    assert!(request(vec![computer(1)]).validate().is_ok());
    assert_eq!(
        request(vec![]).validate(),
        Err(StartUpgradeError::Computers)
    );
    assert_eq!(
        request(vec![computer(1), computer(1)]).validate(),
        Err(StartUpgradeError::Computers)
    );
    let mut big = request(vec![computer(1)]);
    big.batch_size = MAX_BATCH_SIZE + 1;
    assert_eq!(big.validate(), Err(StartUpgradeError::BatchSize));
    let mut none = request(vec![computer(1)]);
    none.batch_size = 0;
    assert_eq!(none.validate(), Err(StartUpgradeError::BatchSize));
    let mut long = request(vec![computer(1)]);
    long.idle_wait = Duration::hours(25);
    assert_eq!(long.validate(), Err(StartUpgradeError::Durations));
}

fn upgrade(state: UpgradeState, batch_size: u8) -> ImageUpgrade {
    ImageUpgrade {
        id: UpgradeId::new(Uuid::from_u128(99)),
        image: ImageVersion::try_new("macro-box/2026-11-24a").unwrap(),
        files: ImageFiles::try_new(vec![
            file(ImageFileName::Vmlinux),
            file(ImageFileName::RootfsExt4),
            file(ImageFileName::BootArgs),
        ])
        .unwrap(),
        sources: None,
        batch_size,
        idle_deadline_at: Utc.timestamp_opt(1_800_000_000, 0).unwrap(),
        reconnect_timeout: Duration::minutes(10),
        state,
        error: None,
        created_by: "run".to_owned(),
        created_at: Utc.timestamp_opt(1_800_000_000, 0).unwrap(),
    }
}

fn row(n: u128, state: ComputerUpgradeState) -> ComputerUpgrade {
    ComputerUpgrade {
        upgrade_id: UpgradeId::new(Uuid::from_u128(99)),
        computer_id: computer(n),
        position: u16::try_from(n).unwrap(),
        state,
        old_image: None,
        new_image: GuestImage::try_new("macro-box/2026-11-24a").unwrap(),
        phase_started_at: None,
        reconnected_at: None,
        error: None,
    }
}

#[test]
fn a_batch_fills_the_free_places_in_order() {
    use ComputerUpgradeState as S;
    let rows = [
        row(1, S::Upgraded),
        row(2, S::Verifying),
        row(4, S::Waiting),
        row(3, S::Waiting),
        row(5, S::Waiting),
    ];
    assert_eq!(
        next_batch(&upgrade(UpgradeState::Rolling, 3), &rows).to_start,
        [computer(3), computer(4)]
    );
    assert!(
        next_batch(&upgrade(UpgradeState::Rolling, 1), &rows)
            .to_start
            .is_empty()
    );
    assert!(
        next_batch(&upgrade(UpgradeState::Paused, 3), &rows)
            .to_start
            .is_empty()
    );
}

#[test]
fn one_rollback_pauses_the_upgrade_and_it_ends_once_nothing_is_under_way() {
    use ComputerUpgradeState as S;
    let rolling = upgrade(UpgradeState::Rolling, 2);
    let rows = [
        row(1, S::RollingBack),
        row(2, S::Verifying),
        row(3, S::Waiting),
    ];
    assert_eq!(settled_state(&rolling, &rows), UpgradeState::Paused);

    let paused = upgrade(UpgradeState::Paused, 2);
    assert!(!is_finished(&paused, &rows));
    let settled = [
        row(1, S::RolledBack),
        row(2, S::Upgraded),
        row(3, S::Waiting),
    ];
    assert!(is_finished(&paused, &settled));

    let all_done = [row(1, S::Upgraded), row(2, S::Skipped)];
    assert_eq!(settled_state(&rolling, &all_done), UpgradeState::Done);
}

#[test]
fn macrod_counts_only_if_it_connected_after_the_state_began() {
    let started = Utc.timestamp_opt(1_800_000_000, 0).unwrap();
    let mut verifying = row(1, ComputerUpgradeState::Verifying);
    verifying.phase_started_at = Some(started);
    verifying.reconnected_at = Some(started - Duration::seconds(1));
    assert!(!verifying.reconnected());
    verifying.reconnected_at = Some(started + Duration::seconds(9));
    assert!(verifying.reconnected());
    assert!(!verifying.timed_out(Duration::minutes(10), started + Duration::minutes(9)));
    assert!(verifying.timed_out(Duration::minutes(10), started + Duration::minutes(10)));
}
