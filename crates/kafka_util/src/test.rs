use super::*;

struct TestConsumerGroup;

impl GroupName for TestConsumerGroup {
    const GROUP_NAME: &'static str = "consumer-group";
}

#[test]
fn producer_config_uses_brokers_and_message_timeout() {
    let config = producer_config("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("message.timeout.ms"), Some(MESSAGE_TIMEOUT_MS));
    assert_eq!(config.get("enable.auto.commit"), None);
}

#[test]
fn grouped_config_uses_named_group_manual_commits_and_earliest_offsets() {
    let config = grouped_config::<TestConsumerGroup>("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("group.id"), Some("consumer-group"));
    assert_eq!(config.get("enable.auto.commit"), Some("false"));
    assert_eq!(config.get("auto.offset.reset"), Some("earliest"));
}

#[test]
fn ungrouped_config_uses_unique_internal_groups_without_offset_storage() {
    let first = ungrouped_config("broker:9092");
    let second = ungrouped_config("broker:9092");
    let first_group = first.get("group.id").unwrap();
    let second_group = second.get("group.id").unwrap();

    assert!(first_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert!(second_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert_ne!(first_group, second_group);
    assert_eq!(first.get("enable.auto.commit"), Some("false"));
    assert_eq!(first.get("enable.auto.offset.store"), Some("false"));
    assert_eq!(first.get("auto.offset.reset"), None);
}
