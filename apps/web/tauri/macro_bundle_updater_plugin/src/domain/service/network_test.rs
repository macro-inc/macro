use super::{
    Target, UpdateStatus,
    tests::{service_with_network, wait_for_status},
};
use crate::domain::ports::AutoUpdateService;

#[tokio::test]
async fn desktop_updates_download_over_vpn_or_unknown_connections() {
    for target in [Target::Darwin, Target::Linux, Target::Windows] {
        for network_type in ["utun0", "tun0", "unknown"] {
            let (service, system_query) = service_with_network(network_type);
            system_query.set_target(target);

            service.start().unwrap();

            wait_for_status(&service, |status| {
                matches!(status, UpdateStatus::DownloadingBundle(_))
            })
            .await;
        }
    }
}

#[tokio::test]
async fn desktop_updates_do_not_depend_on_network_classification() {
    for target in [Target::Darwin, Target::Linux, Target::Windows] {
        let (service, system_query) = service_with_network("unknown");
        system_query.set_target(target);
        system_query.set_network_type_error(true);

        service.start().unwrap();

        wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::DownloadingBundle(_))
        })
        .await;
    }
}

#[tokio::test]
async fn mobile_updates_still_wait_for_wifi_on_cellular_or_unknown_connections() {
    for target in [Target::Ios, Target::Android] {
        for network_type in ["cellular", "unknown", "utun0"] {
            let (service, system_query) = service_with_network(network_type);
            system_query.set_target(target);

            service.start().unwrap();

            wait_for_status(&service, |status| {
                matches!(status, UpdateStatus::WaitingForWifi(_))
            })
            .await;
        }
    }
}

#[tokio::test]
async fn mobile_users_can_still_approve_a_cellular_download() {
    for target in [Target::Ios, Target::Android] {
        let (service, system_query) = service_with_network("cellular");
        system_query.set_target(target);
        service.start().unwrap();
        wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::WaitingForWifi(_))
        })
        .await;

        service.approve_pending_update(true).unwrap();

        wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::DownloadingBundle(_))
        })
        .await;
    }
}
