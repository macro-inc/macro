use super::*;

#[test]
fn base_config_uses_manual_commits_and_earliest_offsets() {
    let config = base_config("broker-a:9092,broker-b:9092", "consumer-group");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("group.id"), Some("consumer-group"));
    assert_eq!(config.get("enable.auto.commit"), Some("false"));
    assert_eq!(config.get("auto.offset.reset"), Some("earliest"));
}
