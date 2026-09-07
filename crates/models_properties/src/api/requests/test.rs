use super::*;

fn select_string_request(values: &[&str]) -> CreatePropertyDefinitionRequest {
    CreatePropertyDefinitionRequest {
        scope: CreatePropertyScope::User,
        display_name: "Department".to_string(),
        data_type: PropertyDataType::SelectString {
            options: values
                .iter()
                .enumerate()
                .map(|(i, value)| SelectStringOption {
                    display_order: i as i32,
                    value: value.to_string(),
                })
                .collect(),
            multi: false,
        },
    }
}

fn select_number_request(values: &[f64]) -> CreatePropertyDefinitionRequest {
    CreatePropertyDefinitionRequest {
        scope: CreatePropertyScope::User,
        display_name: "Priority".to_string(),
        data_type: PropertyDataType::SelectNumber {
            options: values
                .iter()
                .enumerate()
                .map(|(i, value)| SelectNumberOption {
                    display_order: i as i32,
                    value: *value,
                })
                .collect(),
            multi: false,
        },
    }
}

#[test]
fn validate_accepts_distinct_select_options() {
    assert_eq!(
        select_string_request(&["Engineering", "Sales"]).validate(),
        Ok(())
    );
    assert_eq!(select_number_request(&[1.0, 2.0]).validate(), Ok(()));
}

#[test]
fn validate_rejects_empty_string_option() {
    assert_eq!(
        select_string_request(&["Engineering", "  "]).validate(),
        Err(PropertyDefinitionValidationError::EmptyOptionValue)
    );
}

#[test]
fn validate_rejects_duplicate_string_option_after_trim() {
    assert_eq!(
        select_string_request(&["Sales", " Sales "]).validate(),
        Err(PropertyDefinitionValidationError::DuplicateOptionValue {
            value: "Sales".to_string()
        })
    );
}

#[test]
fn validate_rejects_duplicate_number_option() {
    assert_eq!(
        select_number_request(&[1.0, 1.0]).validate(),
        Err(PropertyDefinitionValidationError::DuplicateOptionValue {
            value: "1".to_string()
        })
    );
}

#[test]
fn validate_rejects_non_finite_number_option() {
    assert_eq!(
        select_number_request(&[f64::NAN]).validate(),
        Err(PropertyDefinitionValidationError::InvalidOptionNumber)
    );
}

#[test]
fn validate_ignores_options_for_scalar_types() {
    let request = CreatePropertyDefinitionRequest {
        scope: CreatePropertyScope::Team,
        display_name: "Notes".to_string(),
        data_type: PropertyDataType::String,
    };
    assert_eq!(request.validate(), Ok(()));
}
