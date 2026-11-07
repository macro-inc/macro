use super::*;
#[test]
fn expected_failure_does_not_accept_a_longer_api_name_or_wrapped_error() -> Result<()> {
    let ledger: Ledger = serde_json::from_str(include_str!("../../ledger.json"))?;
    let entry = &ledger.entries[0];
    let exact = crate::replay::ReplayError::Mismatch(entry.failure.clone());
    assert!(entry.matches_failure(&exact));
    let prefix = crate::replay::ReplayError::Mismatch(format!("{}Extra", entry.failure));
    assert!(!entry.matches_failure(&prefix));
    let context =
        crate::replay::ReplayError::Mismatch(format!("earlier failure mentions {}", entry.failure));
    assert!(!entry.matches_failure(&context));
    Ok(())
}
