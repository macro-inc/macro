use super::*;
use crate::domain::ports::UsageHistory;
use crate::domain::usage::{StoredSample, UsageSample};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computer_keeps_one_reading_per_minute_and_old_ones_are_pruned(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "usage-test", 64, 0, 2).await;
    let first = bought(&repo, 1).await.id;
    let second = bought(&repo, 2).await.id;
    let unknown = ComputerId::new_from_uuid(Uuid::from_u128(99));
    let noon = now();

    // 12:00:05: both computers and a guest this database does not know.
    let kept = repo
        .record_usage(
            noon + Duration::seconds(5),
            &[
                UsageSample {
                    computer_id: first,
                    cpu_usage_microseconds: 1_000_000,
                    memory_bytes: 2_000_000_000,
                },
                UsageSample {
                    computer_id: second,
                    cpu_usage_microseconds: 7_000_000,
                    memory_bytes: 3_000_000_000,
                },
                UsageSample {
                    computer_id: unknown,
                    cpu_usage_microseconds: 1,
                    memory_bytes: 1,
                },
            ],
        )
        .await
        .unwrap();
    assert_eq!(kept, 2, "the unknown guest is skipped");

    // 12:00:15, another replica's pass in the same minute: nothing new.
    let kept = repo
        .record_usage(
            noon + Duration::seconds(15),
            &[UsageSample {
                computer_id: first,
                cpu_usage_microseconds: 9_000_000,
                memory_bytes: 9_000_000_000,
            }],
        )
        .await
        .unwrap();
    assert_eq!(kept, 0);

    // 12:01:05: the next minute's reading of the first computer.
    repo.record_usage(
        noon + Duration::seconds(65),
        &[UsageSample {
            computer_id: first,
            cpu_usage_microseconds: 31_000_000,
            memory_bytes: 2_500_000_000,
        }],
    )
    .await
    .unwrap();

    let readings = repo
        .usage_since(&[first, second, unknown], noon)
        .await
        .unwrap();
    let of = |computer_id: ComputerId| -> Vec<StoredSample> {
        readings
            .iter()
            .filter(|(id, _)| *id == computer_id)
            .map(|(_, sample)| *sample)
            .collect()
    };
    assert_eq!(
        of(first),
        vec![
            StoredSample {
                sampled_at: noon + Duration::seconds(5),
                cpu_usage_microseconds: 1_000_000,
                memory_bytes: 2_000_000_000,
            },
            StoredSample {
                sampled_at: noon + Duration::seconds(65),
                cpu_usage_microseconds: 31_000_000,
                memory_bytes: 2_500_000_000,
            },
        ]
    );
    assert_eq!(of(second).len(), 1);
    assert_eq!(of(unknown), vec![]);

    // Readings before 12:01 go; the 12:01 one stays.
    assert_eq!(
        repo.prune_usage(noon + Duration::minutes(1)).await.unwrap(),
        2
    );
    let readings = repo.usage_since(&[first, second], noon).await.unwrap();
    assert_eq!(readings.len(), 1);
    assert_eq!(readings[0].0, first);
}
