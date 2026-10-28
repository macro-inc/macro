use uuid::Uuid;

use super::*;

#[test]
fn a_form_change_names_only_the_form_in_camel_case() {
    assert_eq!(
        serde_json::to_value(FormChanged {
            form_id: FormId::from_uuid(Uuid::from_u128(0xf0)),
        })
        .unwrap(),
        serde_json::json!({"formId": "00000000-0000-0000-0000-0000000000f0"})
    );
    assert_eq!(FORM_CHANGED_MESSAGE_TYPE, "form_changed");
}
