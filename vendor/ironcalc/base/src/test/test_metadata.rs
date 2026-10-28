#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_metadata_new_model() {
    let mut model = new_empty_model();
    model.set_user_input(0, 1, 1, "5.5".to_string()).unwrap();
    model.evaluate();
    let metadata = &model.workbook.metadata;
    assert_eq!(metadata.application, "IronCalc Sheets");
    // FIXME: This will need to be updated once we fix versioning
    assert_eq!(metadata.app_version, "10.0000");
    assert_eq!(metadata.last_modified, "2022-11-08T11:13:28Z");
}
