use macro_event_broker::MacroEventCollection as _;

use super::DeclaredMacroEvent;

#[test]
fn assigns_only_the_typed_soup_topic() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.soup"]);
}
