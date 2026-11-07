use std::sync::Arc;

use super::{NoOpSoupService, SoupService};

#[test]
fn arc_of_soup_service_is_a_soup_service() {
    fn assert_soup_service<T: SoupService>() {}

    assert_soup_service::<Arc<NoOpSoupService>>();
}
