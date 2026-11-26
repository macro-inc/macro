use super::*;

#[test]
fn usage_from_an_agent_without_swap_reads_swap_as_unknown() {
    let usage: Usage = serde_json::from_str(
        r#"{"residentMemoryBytes":3,"privateMemoryBytes":2,"cpuUsageMicroseconds":1}"#,
    )
    .unwrap();
    assert_eq!(
        usage,
        Usage {
            resident_memory_bytes: 3,
            private_memory_bytes: 2,
            swap_bytes: None,
            cpu_usage_microseconds: 1,
        }
    );
}

#[test]
fn usage_carries_swap_as_swap_bytes() {
    let usage = Usage {
        resident_memory_bytes: 3,
        private_memory_bytes: 2,
        swap_bytes: Some(4),
        cpu_usage_microseconds: 1,
    };
    assert_eq!(
        serde_json::to_string(&usage).unwrap(),
        r#"{"residentMemoryBytes":3,"privateMemoryBytes":2,"swapBytes":4,"cpuUsageMicroseconds":1}"#
    );
}
