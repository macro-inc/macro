use super::*;

#[test]
fn tabs_wrap_in_both_directions() {
    assert_eq!(Tab::Overview.previous(), Tab::Logs);
    assert_eq!(Tab::Overview.next(), Tab::Sessions);
    assert_eq!(Tab::Logs.next(), Tab::Overview);
    assert_eq!(Tab::Logs.previous(), Tab::Config);
}
