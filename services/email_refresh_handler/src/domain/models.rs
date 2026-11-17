#[derive(Clone, Copy)]
pub(crate) struct MaintenanceConfig {
    pub(crate) is_production: bool,
    pub(crate) delete_unused_after_days: u32,
    pub(crate) delete_inactive_after_days: u32,
    pub(crate) health_poll_interval_hours: u32,
}
