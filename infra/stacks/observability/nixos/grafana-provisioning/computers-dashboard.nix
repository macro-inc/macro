{ lib }:
let
  datasource = {
    type = "prometheus";
    uid = "prometheus";
  };
  # Written by Alloy on each Firecracker host
  # (nix/hosts/_nixos/firecracker-host.alloy). A `computers` series without
  # `computer_id` is every VM on the host together.
  host = ''job="firecracker-host/host",host=~"$host"'';
  computers = ''job="firecracker-host/computers",host=~"$host",computer_id!=""'';
  allComputers = ''job="firecracker-host/computers",host=~"$host",computer_id=""'';
  target = refId: legendFormat: expr: { inherit refId legendFormat expr; };
  panel = id: title: description: unit: targets: {
    inherit
      id
      title
      description
      datasource
      targets
      ;
    type = "timeseries";
    gridPos = {
      x = lib.mod (id - 1) 2 * 12;
      y = builtins.div (id - 1) 2 * 8;
      w = 12;
      h = 8;
    };
    fieldConfig.defaults = { inherit unit; };
  };
  dashboard = {
    uid = "macro-computers-fleet";
    title = "Macro computers fleet";
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "computers"
    ];
    links = [
      {
        title = "Firecracker hosts: capacity";
        type = "link";
        url = "/d/macro-firecracker-capacity";
        tooltip = "Fleet and per-host capacity, running VMs grouped by host";
      }
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-6h";
      to = "now";
    };
    description = "Firecracker hosts and the computers on them, from each host's cgroups (no agent in guests). Rows: capacity (panels 1-4), noisy neighbours (5-8), overcommit tuning (9-12). The watermarks and ratios a host is held to are its row in hosted_runtime_host; see docs/runbooks/computer-overcommit.md. Alerts stay in Datadog.";
    templating.list = [
      {
        name = "host";
        label = "Host";
        type = "query";
        inherit datasource;
        query = ''label_values(node_memory_MemTotal_bytes{job="firecracker-host/host"}, host)'';
        refresh = 2;
        includeAll = true;
        allValue = ".*";
        multi = true;
        current = {
          text = "All";
          value = "$__all";
        };
      }
    ];
    panels = [
      (panel 1 "Host memory in use"
        "Share of the host's memory not available. Defaults: relief stops under 70 %, the host stops admitting at 80 %, nothing may take it over 90 %."
        "percent"
        [
          (target "A" "{{host}}"
            "100 * (1 - node_memory_MemAvailable_bytes{${host}} / node_memory_MemTotal_bytes{${host}})"
          )
        ]
      )
      (panel 2 "Memory held by computers" "Every VM's cgroup together, against the host's memory." "bytes"
        [
          (target "A" "{{host}} computers" "container_memory_usage_bytes{${allComputers}}")
          (target "B" "{{host}} total" "node_memory_MemTotal_bytes{${host}}")
        ]
      )
      (panel 3 "Computers with a running VM" "Hibernated and stopped computers have no VM." "short" [
        (target "A" "{{host}}" "count by (host) (container_memory_usage_bytes{${computers}})")
      ])
      (panel 4 "Awake vCPUs per host core"
        "The vCPUs of every running VM (their CPU limits) over the host's cores: the CPU overcommit actually in use."
        "short"
        [
          (target "A" "{{host}}"
            ''sum by (host) (container_spec_cpu_quota{${computers}} / container_spec_cpu_period{${computers}}) / count by (host) (node_cpu_seconds_total{${host},mode="idle"})''
          )
        ]
      )
      (panel 5 "Busiest computers: CPU" "Cores in use, top 10." "short" [
        (target "A" "{{host}} {{computer_id}}"
          "topk(10, sum by (host, computer_id) (rate(container_cpu_usage_seconds_total{${computers}}[5m])))"
        )
      ])
      (panel 6 "Largest computers: memory" "Memory charged to the VM, top 10." "bytes" [
        (target "A" "{{host}} {{computer_id}}"
          "topk(10, sum by (host, computer_id) (container_memory_usage_bytes{${computers}}))"
        )
      ])
      (panel 7 "Computers held back by their CPU limit"
        "Seconds per second a VM wanted CPU and its limit refused, top 10."
        "short"
        [
          (target "A" "{{host}} {{computer_id}}"
            "topk(10, sum by (host, computer_id) (rate(container_cpu_cfs_throttled_seconds_total{${computers}}[5m])))"
          )
        ]
      )
      (panel 8 "Host pressure"
        "Share of time something on the host waited for CPU, memory or IO (PSI), and CPU the hypervisor took (steal). Rising CPU waiting with few busy computers means the CPU ratio is too high."
        "percentunit"
        [
          (target "A" "{{host}} cpu waiting" "rate(node_pressure_cpu_waiting_seconds_total{${host}}[5m])")
          (target "B" "{{host}} memory waiting"
            "rate(node_pressure_memory_waiting_seconds_total{${host}}[5m])"
          )
          (target "C" "{{host}} io waiting" "rate(node_pressure_io_waiting_seconds_total{${host}}[5m])")
          (target "D" "{{host}} steal"
            ''avg by (host) (rate(node_cpu_seconds_total{${host},mode="steal"}[5m]))''
          )
        ]
      )
      (panel 9 "Memory sold to running computers per byte they hold"
        "The memory limits of running VMs over the memory they hold: how far memory could be overcommitted with today's use."
        "short"
        [
          (target "A" "{{host}}"
            "sum by (host) (container_spec_memory_limit_bytes{${computers}}) / sum by (host) (container_memory_usage_bytes{${computers}})"
          )
        ]
      )
      (panel 10 "Memory per computer" "Median and 90th percentile of what one VM holds." "bytes" [
        (target "A" "{{host}} p50"
          "quantile by (host) (0.5, sum by (host, computer_id) (container_memory_usage_bytes{${computers}}))"
        )
        (target "B" "{{host}} p90"
          "quantile by (host) (0.9, sum by (host, computer_id) (container_memory_usage_bytes{${computers}}))"
        )
      ])
      (panel 11 "Squeezed and shared memory"
        "Swap in use (idle computers squeezed into zram) and memory KSM shares."
        "bytes"
        [
          (target "A" "{{host}} swap"
            "node_memory_SwapTotal_bytes{${host}} - node_memory_SwapFree_bytes{${host}}"
          )
          (target "B" "{{host}} KSM shared" "node_ksmd_pages_sharing{${host}} * 4096")
        ]
      )
      (panel 12 "Load per core" "Above 1 the host has more runnable work than cores." "short" [
        (target "A" "{{host}}"
          ''sum by (host) (node_load1{${host}}) / count by (host) (node_cpu_seconds_total{${host},mode="idle"})''
        )
      ])
    ];
  };
in
dashboard
