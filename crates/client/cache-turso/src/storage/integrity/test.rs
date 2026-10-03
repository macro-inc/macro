use super::*;
use crate::storage::text;

#[test]
fn quick_check_requires_exactly_one_ok_text_row() {
    assert!(validate_quick_check_rows(&[vec![text("ok")]]).is_ok());
    for rows in [
        Vec::new(),
        vec![vec![text("corrupt")]],
        vec![vec![text("ok")], vec![text("ok")]],
        vec![vec![text("ok"), text("extra")]],
        vec![vec![Value::from_i64(1)]],
    ] {
        assert_eq!(
            validate_quick_check_rows(&rows)
                .unwrap_err()
                .physical_reset_reason(),
            Some(PhysicalResetReason::Integrity)
        );
    }
}
