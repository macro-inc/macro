''
  prometheus.exporter.unix "host" {
    // Read host mounts even when systemd gives the collector a private mount namespace.
    rootfs_path = "/proc/1/root"
    disable_collectors = ["textfile"]
  }

  prometheus.scrape "host" {
    targets = prometheus.exporter.unix.host.targets
    job_name = "observability/host"
    scrape_interval = "30s"
    forward_to = [prometheus.remote_write.local.receiver]
  }

  prometheus.exporter.cadvisor "containers" {
    docker_only = true
    // Docker's storage client uses its own namespace. Leave the generic
    // containerd namespace at its default so it cannot claim Docker containers.
    containerd_host = "/run/docker/containerd/containerd.sock"
    containerd_namespace = "k8s.io"
    store_container_labels = false
    allowlisted_container_labels = ["com.docker.compose.project", "com.docker.compose.service"]
    enabled_metrics = ["cpu", "memory", "network", "disk", "diskIO", "oom_event"]
  }

  prometheus.scrape "containers" {
    targets = prometheus.exporter.cadvisor.containers.targets
    job_name = "observability/containers"
    scrape_interval = "30s"
    forward_to = [prometheus.relabel.containers.receiver]
  }

  prometheus.relabel "containers" {
    forward_to = [prometheus.remote_write.local.receiver]
    rule {
      source_labels = ["__name__", "container_label_com_docker_compose_project"]
      regex = "up;|scrape_.*;|.*;macro-observability"
      action = "keep"
    }
  }

  prometheus.exporter.self "host_alloy" {}
  prometheus.scrape "host_alloy" {
    targets = prometheus.exporter.self.host_alloy.targets
    job_name = "observability/host-alloy"
    scrape_interval = "30s"
    forward_to = [prometheus.remote_write.local.receiver]
  }

  prometheus.remote_write "local" {
    endpoint { url = "http://127.0.0.1:9090/api/v1/write" }
    wal {
      min_keepalive_time = "5m"
      max_keepalive_time = "1h"
    }
  }

  discovery.docker "stack" {
    host = "unix:///var/run/docker.sock"
    filter {
      name = "label"
      values = ["com.docker.compose.project=macro-observability"]
    }
  }

  discovery.relabel "containers" {
    targets = discovery.docker.stack.targets
    rule {
      source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
      target_label = "service_name"
    }
  }

  loki.source.docker "stack" {
    host = "unix:///var/run/docker.sock"
    targets = discovery.relabel.containers.output
    labels = {job = "observability/containers", instance = constants.hostname}
    forward_to = [loki.write.local.receiver]
  }

  loki.relabel "journal" {
    forward_to = []
    rule {
      source_labels = ["__journal__systemd_unit"]
      regex = "(docker|observability|alloy|amazon-cloudwatch-agent|systemd-.*)\\.service"
      action = "keep"
    }
    rule {
      source_labels = ["__journal__systemd_unit"]
      target_label = "unit"
    }
    rule {
      source_labels = ["__journal_priority_keyword"]
      target_label = "level"
    }
  }

  loki.source.journal "host" {
    max_age = "1h"
    labels = {job = "observability/journal", instance = constants.hostname}
    relabel_rules = loki.relabel.journal.rules
    forward_to = [loki.write.local.receiver]
  }

  loki.source.journal "kernel" {
    matches = "_TRANSPORT=kernel"
    max_age = "1h"
    labels = {job = "observability/kernel", instance = constants.hostname}
    forward_to = [loki.write.local.receiver]
  }

  loki.write "local" {
    endpoint { url = "http://127.0.0.1:3100/loki/api/v1/push" }
  }
''
