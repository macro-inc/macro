/// The definitions routes nest beside the legacy `/{saved_view_id}` routes;
/// a conflicting path would panic here instead of at service startup.
#[test]
fn definitions_nest_beside_the_legacy_routes() {
    let _router = super::router();
}
