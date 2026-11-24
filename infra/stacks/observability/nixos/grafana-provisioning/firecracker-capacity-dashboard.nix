# How full the Firecracker hosts are and where their running VMs sit, for
# placement and capacity decisions. Same series as the Macro computers fleet
# dashboard (computers-dashboard.nix), written by Alloy on each host
# (nix/hosts/_nixos/firecracker-host.alloy):
# - `firecracker-host/host`: node_exporter, the host (a machine or a nested VM);
# - `firecracker-host/computers`: cAdvisor over the VMs' cgroups. A series with
#   a `computer_id` is one running VM; the one without is every VM together
#   (the parent cgroup, present while the host runs). Hibernated and stopped
#   computers have no cgroup, so no series.
# A VM is shown only by an alias, the last 8 hex digits of its computer id
# (`vm`). Computer ids are UUIDv7: the first digits are the creation time, the
# last are random, so VMs created together never share an alias. The full id
# never reaches a legend, table, tooltip or URL.
#
# Current values follow one freshness rule: a series counts only with a sample
# in the last 2 minutes (`fresh`). A host is covered when both its
# node_exporter and its cAdvisor (the parent cgroup) are fresh; VM counts and
# reservations exist only for covered hosts, and fleet ratios divide only by
# the hosts their numerator has. A host without telemetry shows as missing,
# never as 0.
{ lib }:
let
  datasource = {
    type = "prometheus";
    uid = "prometheus";
  };

  byHost = "host, deployment_environment";
  host = ''job="firecracker-host/host",deployment_environment=~"$env",host=~"$host"'';
  # Every running VM of the selected hosts, and the parent cgroup of all of them.
  vms = ''job="firecracker-host/computers",deployment_environment=~"$env",host=~"$host",computer_id!=""'';
  parent = ''job="firecracker-host/computers",deployment_environment=~"$env",host=~"$host",computer_id=""'';
  # The running VMs of one repeated host row, narrowed by the alias prefix box:
  # the alias starts at character 29 of the 36-character id.
  hostVms = ''job="firecracker-host/computers",host="$host",computer_id!="",computer_id=~".{28}$vm.*"'';
  # The filesystem computers' disks live on: the ZFS dataset `<pool>/firecracker`
  # and its clones, or the XFS mount (`macro.firecrackerHost.storage`).
  storage = ''${host},fstype=~"zfs|xfs",mountpoint=~"/[^/]+/firecracker(/.*)?|/var/lib/firecracker-host"'';

  # Default `memory_high_watermark_percent` (docs/runbooks/computer-overcommit.md).
  watermark = "0.8";

  fresh = metric: selector: "last_over_time(${metric}{${selector}}[2m])";
  nodeUp = "group by (${byHost}) (${fresh "node_memory_MemTotal_bytes" host})";
  cadvisorUp = "group by (${byHost}) (${fresh "container_memory_usage_bytes" parent})";
  covered = "(${nodeUp} and on (host) ${cadvisorUp})";
  seenToday = "group by (${byHost}) (max_over_time(node_memory_MemTotal_bytes{${host}}[1d]))";

  coresByHost = "count by (${byHost}) (${fresh "node_cpu_seconds_total" ''${host},mode="idle"''})";
  memTotalByHost = "sum by (${byHost}) (${fresh "node_memory_MemTotal_bytes" host})";
  # Only where both MemTotal and MemAvailable are fresh.
  memUsedByHost = "sum by (${byHost}) (${fresh "node_memory_MemTotal_bytes" host} - ${fresh "node_memory_MemAvailable_bytes" host})";
  ramUsedByHost = "100 * ${memUsedByHost} / ${memTotalByHost}";
  ramUsedFleet = "100 * sum(${memUsedByHost}) / sum(${memTotalByHost} and on (host) ${memUsedByHost})";
  # Idle seconds over all CPU seconds of the same cores and window, so a
  # window a host's samples only partly cover (it just went silent) or a core
  # without a rate changes both sides alike.
  cpuRate = mode: "(rate(node_cpu_seconds_total{${host}${mode}}[5m]) and on (host) ${nodeUp})";
  cpuBusy = by: "100 * (1 - sum${by} (${cpuRate '',mode="idle"''}) / sum${by} (${cpuRate ""}))";
  cpuBusyByHost = cpuBusy " by (${byHost})";
  cpuBusyFleet = cpuBusy "";
  headroomByHost = "clamp_min(${watermark} * ${memTotalByHost} - ${memUsedByHost}, 0)";
  # ZFS: a dataset's available space is the pool's free space less quotas and
  # reservations; its size minus that is what it references, and clones count
  # the blocks they share with their golden while snapshot-only blocks are
  # missed, so the referenced sum is an estimate. XFS: the one filesystem.
  storageAvailableByHost = "max by (${byHost}) (${fresh "node_filesystem_avail_bytes" storage})";
  storageReferencedByHost = "sum by (${byHost}) (${fresh "node_filesystem_size_bytes" storage} - ${fresh "node_filesystem_avail_bytes" storage})";
  psi =
    resource:
    "(sum by (${byHost}) (rate(node_pressure_${resource}_waiting_seconds_total{${host}}[5m])) and on (host) ${nodeUp})";

  vmMemoryFresh = fresh "container_memory_usage_bytes" vms;
  vmCountByHost = "count by (${byHost}) (${vmMemoryFresh})";
  # 0 only where cAdvisor is fresh and shows no VM.
  zeroIfNoVms = "(${cadvisorUp} * 0 unless on (host) ${vmCountByHost})";
  runningVmsByHost = "((${vmCountByHost} and on (host) ${cadvisorUp}) or ${zeroIfNoVms})";
  # A host's reservations count only when every running VM has the limit.
  reservedByHost =
    perVm:
    "((sum by (${byHost}) (${perVm}) and on (host) (count by (${byHost}) (${perVm}) == ${vmCountByHost}) and on (host) ${cadvisorUp}) or ${zeroIfNoVms})";
  vcpusByHost = reservedByHost "${fresh "container_spec_cpu_quota" vms} / ${fresh "container_spec_cpu_period" vms}";
  memoryLimitsByHost = reservedByHost (fresh "container_spec_memory_limit_bytes" vms);
  vcpuPerCoreByHost = "${vcpusByHost} / ${coresByHost}";
  vcpuPerCoreFleet = "sum(${vcpusByHost}) / sum(${coresByHost} and on (host) ${vcpusByHost})";
  memoryCommittedByHost = "100 * ${memoryLimitsByHost} / ${memTotalByHost}";
  memoryCommittedFleet = "100 * sum(${memoryLimitsByHost}) / sum(${memTotalByHost} and on (host) ${memoryLimitsByHost})";

  # Newest sample of each host: exact within the 5 minute lookback, else the
  # last day's newest at minute resolution.
  lastSample = "max by (${byHost}) (timestamp(node_memory_MemTotal_bytes{${host}})) or max by (${byHost}) (max_over_time(timestamp(node_memory_MemTotal_bytes{${host}})[1d:1m]))";
  sampleAge = "time() - (${lastSample})";

  # One VM's series, labelled by its alias.
  vm = expr: ''label_replace(${expr}, "vm", "$1", "computer_id", ".*([0-9a-f]{8})")'';
  perVm = expr: "sum by (host, vm) (${vm expr})";
  vmPresent = perVm (fresh "container_memory_usage_bytes" hostVms);
  vmCpu = "${perVm "rate(container_cpu_usage_seconds_total{${hostVms}}[5m])"} and on (host, vm) ${vmPresent}";
  vmVcpus = perVm "${fresh "container_spec_cpu_quota" hostVms} / ${fresh "container_spec_cpu_period" hostVms}";
  vmMemory = vmPresent;
  vmMemoryLimit = perVm (fresh "container_spec_memory_limit_bytes" hostVms);
  vmThrottled = "${perVm "rate(container_cpu_cfs_throttled_seconds_total{${hostVms}}[5m])"} and on (host, vm) ${vmPresent}";
  vmCpuShare = "100 * (${vmCpu}) / ${vmVcpus}";
  vmMemoryShare = "100 * ${vmMemory} / ${vmMemoryLimit}";
  # Tiles over time. `tile` is 1 for cpu and 0 for memory; only the chosen
  # query returns data. A tile shows only for a VM fresh at the end of the
  # range (`@ end()`), so a stopped VM or a silent host doesn't linger.
  tileCpuShare = "100 * ${perVm "rate(container_cpu_usage_seconds_total{${hostVms}}[5m])"} / ${perVm "container_spec_cpu_quota{${hostVms}} / container_spec_cpu_period{${hostVms}}"}";
  tileMemoryShare = "100 * ${perVm "container_memory_usage_bytes{${hostVms}}"} / ${perVm "container_spec_memory_limit_bytes{${hostVms}}"}";
  whenTile =
    value: expr:
    "(${expr}) and on () (vector($tile) == ${toString value}) and on (host, vm) ${perVm "last_over_time(container_memory_usage_bytes{${hostVms}}[2m] @ end())"}";

  noFleet = "No firecracker-host series in Mimir";
  noTelemetry = "no telemetry";
  # A covered host with no running VM (or none matching the alias) looks the
  # same as a host without cAdvisor here; the Hosts table tells them apart.
  noHost = "No running VM, or no cAdvisor telemetry from this host: see Hosts";

  steps = colors: {
    mode = "absolute";
    steps = lib.imap0 (i: step: {
      color = builtins.elemAt step 0;
      value = if i == 0 then null else builtins.elemAt step 1;
    }) colors;
  };
  # Host load: the default relief (70 %) and admission (80 %) watermarks.
  loadSteps = steps [
    [ "green" ]
    [
      "orange"
      70
    ]
    [
      "red"
      80
    ]
  ];
  storageSteps = steps [
    [ "green" ]
    [
      "orange"
      75
    ]
    [
      "red"
      90
    ]
  ];
  # Default allocation ratios: 6 vCPUs per core, memory limits at 400 %.
  vcpuSteps = steps [
    [ "green" ]
    [
      "orange"
      4.8
    ]
    [
      "red"
      6
    ]
  ];
  memoryCommitSteps = steps [
    [ "green" ]
    [
      "orange"
      320
    ]
    [
      "red"
      400
    ]
  ];
  shareSteps = steps [
    [ "green" ]
    [
      "orange"
      70
    ]
    [
      "red"
      90
    ]
  ];
  neutral = steps [ [ "blue" ] ];

  # Missing data in a neutral colour, so it never reads as healthy.
  missing = color: text: [
    {
      type = "special";
      options = {
        match = "null+nan";
        result = {
          inherit text color;
          index = 0;
        };
      };
    }
  ];

  target = refId: legendFormat: expr: {
    inherit refId legendFormat expr;
  };
  instant = refId: expr: {
    inherit refId expr;
    instant = true;
    range = false;
    format = "table";
  };

  pos = x: y: w: h: {
    inherit
      x
      y
      w
      h
      ;
  };

  stat =
    {
      id,
      title,
      description,
      gridPos,
      expr,
      unit ? "short",
      thresholds ? neutral,
      noValue ? noFleet,
      decimals ? null,
    }:
    {
      inherit
        id
        title
        description
        datasource
        gridPos
        ;
      type = "stat";
      targets = [
        {
          refId = "A";
          inherit expr;
          instant = true;
          range = false;
        }
      ];
      fieldConfig.defaults = {
        inherit unit thresholds noValue;
        mappings = missing "text" noValue;
        color.mode = "thresholds";
      }
      // lib.optionalAttrs (decimals != null) { inherit decimals; };
      options = {
        graphMode = "none";
        colorMode = "background";
        textMode = "value";
        justifyMode = "center";
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    };

  timeseries =
    {
      id,
      title,
      description,
      gridPos,
      targets,
      unit,
      thresholds ? null,
      noValue ? noFleet,
    }:
    {
      inherit
        id
        title
        description
        datasource
        gridPos
        targets
        ;
      type = "timeseries";
      fieldConfig.defaults = {
        inherit unit noValue;
        custom = {
          fillOpacity = 0;
          showPoints = "never";
        }
        // lib.optionalAttrs (thresholds != null) { thresholdsStyle.mode = "dashed"; };
      }
      // lib.optionalAttrs (thresholds != null) { inherit thresholds; };
      options = {
        legend = {
          displayMode = "list";
          placement = "bottom";
          showLegend = true;
        };
        tooltip = {
          mode = "multi";
          sort = "desc";
        };
      };
    };

  text = id: title: gridPos: content: {
    inherit id title gridPos;
    type = "text";
    options = {
      mode = "markdown";
      inherit content;
    };
  };

  row =
    id: y: title: extra:
    {
      inherit id title;
      type = "row";
      collapsed = false;
      gridPos = pos 0 y 24 1;
      panels = [ ];
    }
    // extra;

  # A column of a merged table: its query's `Value #<ref>` renamed, with a
  # unit and, if given, cell colors.
  column = ref: name: unit: thresholds: {
    matcher = {
      id = "byName";
      options = name;
    };
    properties = [
      {
        id = "unit";
        value = unit;
      }
    ]
    ++ lib.optionals (thresholds != null) [
      {
        id = "thresholds";
        value = thresholds;
      }
      {
        id = "custom.cellOptions";
        value.type = "color-background";
      }
    ];
  };

  table =
    {
      id,
      title,
      description,
      gridPos,
      columns,
      keys,
      noValue,
      sortBy,
      extraOverrides ? [ ],
    }:
    {
      inherit
        id
        title
        description
        datasource
        gridPos
        ;
      type = "table";
      targets = map (c: instant c.ref c.expr) columns;
      transformations = [
        {
          id = "merge";
          options = { };
        }
        {
          id = "organize";
          options = {
            excludeByName.Time = true;
            indexByName = lib.listToAttrs (
              lib.imap0 (i: name: lib.nameValuePair name i) (keys ++ map (c: "Value #${c.ref}") columns)
            );
            renameByName = lib.listToAttrs (map (c: lib.nameValuePair "Value #${c.ref}" c.name) columns);
          };
        }
      ];
      fieldConfig = {
        defaults = {
          inherit noValue;
          mappings = missing "transparent" noValue;
          custom = {
            filterable = true;
            align = "auto";
          };
        };
        overrides = map (c: column c.ref c.name c.unit (c.thresholds or null)) columns ++ extraOverrides;
      };
      options = {
        showHeader = true;
        cellHeight = "sm";
        inherit sortBy;
      };
    };

  fleetHint = "Host numbers come from node_exporter; vCPU and memory limits are the cgroup limits of running VMs (reservations, not use).";

  red1 = steps [
    [ "green" ]
    [
      "red"
      1
    ]
  ];

  # 0: no host reports; 1: some host seen today is silent or lacks cAdvisor;
  # 2: every host seen today reports both.
  incomplete = "(count(${nodeUp} unless on (host) ${cadvisorUp}) or vector(0)) + (count(${seenToday} unless on (host) ${nodeUp}) or vector(0))";
  banner = {
    id = 1;
    title = "";
    description = "Telemetry coverage of the hosts seen in the last day. A host counts with a node_exporter sample in the last 2 minutes; it is covered when its cAdvisor (the VMs' parent cgroup) is fresh too. Red: nothing reaches Mimir, so panels are empty for lack of telemetry, not because hosts are idle. Orange: fleet totals leave the silent or uncovered hosts out.";
    inherit datasource;
    type = "stat";
    gridPos = pos 0 0 24 3;
    targets = [
      {
        refId = "A";
        expr = "(clamp_max(count(${nodeUp}), 1) * (1 + ((${incomplete}) == bool 0))) or vector(0)";
        instant = true;
        range = false;
      }
    ];
    fieldConfig.defaults = {
      color.mode = "thresholds";
      thresholds = steps [
        [ "red" ]
        [
          "orange"
          1
        ]
        [
          "green"
          2
        ]
      ];
      mappings = [
        {
          type = "value";
          options = {
            "0" = {
              text = "No Firecracker host is reporting: no firecracker-host series in Mimir. Panels below are blank because telemetry is missing.";
              color = "red";
              index = 0;
            };
            "1" = {
              text = "Partial telemetry: a host is silent or has no cAdvisor. Fleet totals count covered hosts only; see Hosts.";
              color = "orange";
              index = 1;
            };
            "2" = {
              text = "Every host seen today reports node_exporter and cAdvisor";
              color = "green";
              index = 2;
            };
          };
        }
      ];
    };
    options = {
      graphMode = "none";
      colorMode = "background";
      textMode = "value";
      justifyMode = "center";
      reduceOptions = {
        calcs = [ "lastNotNull" ];
        fields = "";
        values = false;
      };
    };
  };

  coveredOnly = "Only hosts with fresh node_exporter and cAdvisor, and limits for every running VM, count, on both sides of the ratio; see Hosts covered.";

  # Fleet summary tiles, six to a line.
  summary =
    lib.imap0
      (
        i: tile:
        stat (
          tile
          // {
            id = 10 + i;
            gridPos = pos (lib.mod i 6 * 4) (4 + builtins.div i 6 * 4) 4 4;
          }
        )
      )
      [
        {
          title = "Hosts reporting";
          description = "Hosts with a node_exporter sample in the last 2 minutes.";
          expr = "count(${nodeUp}) or vector(0)";
          thresholds = steps [
            [ "red" ]
            [
              "green"
              1
            ]
          ];
        }
        {
          title = "Hosts silent";
          description = "Hosts seen in the last 24 h with no node_exporter sample in the last 2 minutes: down, or their Alloy can't reach Mimir.";
          expr = "count(${seenToday} unless on (host) ${nodeUp}) or (count(${seenToday}) * 0)";
          thresholds = red1;
        }
        {
          title = "Hosts covered";
          description = "Reporting hosts whose cAdvisor (the VMs' parent cgroup) is fresh too. VM counts and reservations below include only these.";
          expr = "count(${covered}) or (count(${seenToday}) * 0)";
          thresholds = steps [
            [ "red" ]
            [
              "green"
              1
            ]
          ];
        }
        {
          title = "Running VMs";
          description = "VMs with a cgroup now on covered hosts (cAdvisor). Hibernated and stopped computers have none and are not counted.";
          expr = "sum(${runningVmsByHost})";
        }
        {
          title = "Host cores";
          description = "Logical CPUs of the reporting hosts (node_exporter).";
          expr = "sum(${coresByHost})";
        }
        {
          title = "RAM";
          description = "MemTotal of the reporting hosts (node_exporter).";
          expr = "sum(${memTotalByHost})";
          unit = "bytes";
        }
        {
          title = "CPU busy";
          description = "Share of the reporting hosts' cores not idle over 5 minutes (node_exporter).";
          expr = cpuBusyFleet;
          unit = "percent";
          thresholds = loadSteps;
          decimals = 1;
        }
        {
          title = "RAM in use";
          description = "MemTotal - MemAvailable over MemTotal, over the hosts that report both: what the admission watermarks are measured on (node_exporter).";
          expr = ramUsedFleet;
          unit = "percent";
          thresholds = loadSteps;
          decimals = 1;
        }
        {
          title = "Storage available";
          description = "Space computers' disks can still take, per host: the ZFS dataset <pool>/firecracker's available space (pool free less quotas and reservations) or the XFS mount's, summed (node_exporter).";
          expr = "sum(${storageAvailableByHost})";
          noValue = "No telemetry for the computers' filesystem";
          unit = "bytes";
        }
        {
          title = "vCPUs committed per core";
          description = "CPU limits of running VMs (reservations) over host cores. Default allocation ratio: 6. ${coveredOnly}";
          expr = vcpuPerCoreFleet;
          thresholds = vcpuSteps;
          decimals = 2;
        }
        {
          title = "Memory limits / RAM";
          description = "Memory limits of running VMs (reservations) over host RAM. Default allocation ratio: 400 %. ${coveredOnly}";
          expr = memoryCommittedFleet;
          unit = "percent";
          thresholds = memoryCommitSteps;
          decimals = 0;
        }
        {
          title = "Headroom to 80 % (default watermark)";
          description = "Memory each reporting host can still take before the default admission watermark (80 % of MemTotal), summed; a host past it counts 0. A host whose row sets another watermark differs (docs/runbooks/computer-overcommit.md).";
          expr = "sum(${headroomByHost})";
          unit = "bytes";
        }
      ];

  links = [
    {
      title = "Macro computers fleet";
      type = "link";
      url = "/d/macro-computers-fleet";
      tooltip = "Per-computer noisy neighbours and overcommit tuning";
    }
  ];

  nodeRowY = 12;
  psiSteps =
    orange: red:
    steps [
      [ "green" ]
      [
        "orange"
        orange
      ]
      [
        "red"
        red
      ]
    ];
  nodeColumns = [
    {
      ref = "A";
      name = "Cores";
      unit = "short";
      expr = coresByHost;
    }
    {
      ref = "B";
      name = "RAM";
      unit = "bytes";
      expr = memTotalByHost;
    }
    {
      ref = "C";
      name = "CPU busy";
      unit = "percent";
      expr = cpuBusyByHost;
      thresholds = loadSteps;
    }
    {
      ref = "D";
      name = "RAM used";
      unit = "percent";
      expr = ramUsedByHost;
      thresholds = loadSteps;
    }
    {
      ref = "E";
      name = "Storage available";
      unit = "bytes";
      expr = storageAvailableByHost;
    }
    {
      ref = "F";
      name = "Referenced (estimate)";
      unit = "bytes";
      expr = storageReferencedByHost;
    }
    {
      ref = "G";
      name = "Running VMs";
      unit = "short";
      expr = runningVmsByHost;
    }
    {
      ref = "H";
      name = "vCPU / core";
      unit = "short";
      expr = vcpuPerCoreByHost;
      thresholds = vcpuSteps;
    }
    {
      ref = "I";
      name = "Mem limits / RAM";
      unit = "percent";
      expr = memoryCommittedByHost;
      thresholds = memoryCommitSteps;
    }
    {
      ref = "J";
      name = "Headroom";
      unit = "bytes";
      expr = headroomByHost;
    }
    {
      ref = "K";
      name = "PSI cpu";
      unit = "percentunit";
      expr = psi "cpu";
      thresholds = psiSteps 0.1 0.25;
    }
    {
      ref = "L";
      name = "PSI memory";
      unit = "percentunit";
      expr = psi "memory";
      thresholds = psiSteps 0.01 0.05;
    }
    {
      ref = "M";
      name = "Last sample";
      unit = "s";
      expr = sampleAge;
      thresholds = steps [
        [ "green" ]
        [
          "red"
          120
        ]
      ];
    }
    {
      ref = "N";
      name = "Status";
      unit = "none";
      expr = "(${sampleAge}) > bool 120";
    }
    {
      ref = "O";
      name = "cAdvisor";
      unit = "none";
      expr = "${cadvisorUp} or (${nodeUp} * 0)";
    }
  ];

  # A status column: its values as words on a coloured cell.
  statusColumn = name: values: {
    matcher = {
      id = "byName";
      options = name;
    };
    properties = [
      {
        id = "mappings";
        value = [
          {
            type = "value";
            options = lib.listToAttrs (
              lib.imap0 (
                i: v:
                lib.nameValuePair (builtins.elemAt v 0) {
                  text = builtins.elemAt v 1;
                  color = builtins.elemAt v 2;
                  index = i;
                }
              ) values
            );
          }
        ]
        ++ missing "transparent" noTelemetry;
      }
      {
        id = "custom.cellOptions";
        value.type = "color-background";
      }
    ];
  };

  nodes = [
    (row 2 nodeRowY "Node distribution" { })
    (table {
      id = 30;
      title = "Hosts";
      description = "One row per host seen in the last day; a value needs a sample in the last 2 minutes. Cores to Headroom and PSI are node_exporter; Running VMs, vCPU / core and Mem limits / RAM are cAdvisor (cgroup limits of running VMs: reservations) and stay empty without fresh cAdvisor or with a VM missing its limit. Storage available: the dataset or mount's available space; Referenced (estimate): what its datasets reference, counting clones' shared blocks and missing snapshot-only ones. Headroom: memory left before the default 80 % admission watermark. PSI: share of time tasks waited.";
      gridPos = pos 0 (nodeRowY + 1) 24 10;
      columns = nodeColumns;
      keys = [
        "host"
        "deployment_environment"
      ];
      # Also every cell of a host that stopped reporting.
      noValue = noTelemetry;
      sortBy = [
        {
          displayName = "RAM used";
          desc = true;
        }
      ];
      extraOverrides = [
        {
          matcher = {
            id = "byName";
            options = "deployment_environment";
          };
          properties = [
            {
              id = "displayName";
              value = "env";
            }
          ];
        }
        (statusColumn "Status" [
          [
            "0"
            "ok"
            "green"
          ]
          [
            "1"
            "stale > 2m"
            "red"
          ]
        ])
        (statusColumn "cAdvisor" [
          [
            "1"
            "fresh"
            "green"
          ]
          [
            "0"
            "missing"
            "red"
          ]
        ])
      ];
    })
    {
      id = 31;
      title = "Running VMs per host";
      description = "VMs with a cgroup now, per covered host (cAdvisor).";
      inherit datasource;
      type = "bargauge";
      gridPos = pos 0 (nodeRowY + 11) 12 7;
      targets = [
        {
          refId = "A";
          expr = "sort_desc(sum by (host) (${runningVmsByHost}))";
          legendFormat = "{{host}}";
          instant = true;
          range = false;
        }
      ];
      fieldConfig.defaults = {
        unit = "short";
        min = 0;
        noValue = noFleet;
        color.mode = "fixed";
        color.fixedColor = "blue";
      };
      options = {
        orientation = "horizontal";
        displayMode = "basic";
        showUnfilled = true;
        minVizHeight = 16;
        maxVizHeight = 32;
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    }
    {
      id = 32;
      title = "RAM used per host";
      description = "MemTotal - MemAvailable over MemTotal per host (node_exporter); orange at the default 70 % relief watermark, red at the 80 % admission one.";
      inherit datasource;
      type = "bargauge";
      gridPos = pos 12 (nodeRowY + 11) 12 7;
      targets = [
        {
          refId = "A";
          expr = "sort_desc(sum by (host) (${ramUsedByHost}))";
          legendFormat = "{{host}}";
          instant = true;
          range = false;
        }
      ];
      fieldConfig.defaults = {
        unit = "percent";
        min = 0;
        max = 100;
        noValue = noFleet;
        thresholds = loadSteps;
        color.mode = "thresholds";
      };
      options = {
        orientation = "horizontal";
        displayMode = "gradient";
        showUnfilled = true;
        minVizHeight = 16;
        maxVizHeight = 32;
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    }
    (timeseries {
      id = 33;
      title = "CPU busy per host";
      description = "Share of the host's cores not idle (node_exporter).";
      gridPos = pos 0 (nodeRowY + 18) 12 8;
      unit = "percent";
      thresholds = loadSteps;
      targets = [ (target "A" "{{host}}" cpuBusyByHost) ];
    })
    (timeseries {
      id = 34;
      title = "RAM used per host";
      description = "MemTotal - MemAvailable over MemTotal (node_exporter), against the default 70 % and 80 % watermarks.";
      gridPos = pos 12 (nodeRowY + 18) 12 8;
      unit = "percent";
      thresholds = loadSteps;
      targets = [ (target "A" "{{host}}" ramUsedByHost) ];
    })
  ];

  vmRowY = nodeRowY + 26;
  vmTableColumns = [
    {
      ref = "A";
      name = "CPU cores";
      unit = "short";
      expr = vmCpu;
    }
    {
      ref = "B";
      name = "CPU % of limit";
      unit = "percent";
      expr = vmCpuShare;
      thresholds = shareSteps;
    }
    {
      ref = "C";
      name = "Memory held";
      unit = "bytes";
      expr = vmMemory;
    }
    {
      ref = "D";
      name = "Memory % of limit";
      unit = "percent";
      expr = vmMemoryShare;
      thresholds = shareSteps;
    }
    {
      ref = "E";
      name = "Throttled s/s";
      unit = "short";
      expr = vmThrottled;
      thresholds = steps [
        [ "green" ]
        [
          "orange"
          0.1
        ]
        [
          "red"
          0.5
        ]
      ];
    }
    {
      ref = "F";
      name = "vCPU limit";
      unit = "short";
      expr = vmVcpus;
    }
    {
      ref = "G";
      name = "Memory limit";
      unit = "bytes";
      expr = vmMemoryLimit;
    }
  ];

  vmRow = [
    (row 4 vmRowY "Running VMs on $host" { repeat = "host"; })
    {
      id = 40;
      title = "VMs on $host: \${tile:text} % of limit";
      description = "One tile per VM running now (its alias: the last 8 hex digits of its computer id), the chosen resource as a share of the VM's own cgroup limit (its reservation), with its last hours. Pick cpu or memory with Tile metric; tiles are in alias order. Absolute numbers are in the table.";
      inherit datasource;
      type = "stat";
      gridPos = pos 0 (vmRowY + 1) 12 10;
      targets = [
        (target "A" "{{vm}}" (whenTile 1 tileCpuShare))
        (target "B" "{{vm}}" (whenTile 0 tileMemoryShare))
      ];
      fieldConfig.defaults = {
        unit = "percent";
        min = 0;
        max = 100;
        decimals = 0;
        noValue = noHost;
        mappings = missing "text" noHost;
        thresholds = shareSteps;
        color.mode = "thresholds";
      };
      options = {
        graphMode = "area";
        colorMode = "background";
        textMode = "value_and_name";
        justifyMode = "center";
        orientation = "auto";
        wideLayout = true;
        minVizWidth = 110;
        minVizHeight = 60;
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    }
    (table {
      id = 41;
      title = "VMs on $host";
      description = "Each VM running now (a cAdvisor sample in the last 2 minutes), by alias, against its cgroup limits (reservations). Sort by any column; filter in the header. Throttled: seconds per second the VM wanted CPU its limit refused.";
      gridPos = pos 12 (vmRowY + 1) 12 10;
      columns = vmTableColumns;
      keys = [ "vm" ];
      noValue = noHost;
      sortBy = [
        {
          displayName = "Memory held";
          desc = true;
        }
      ];
      extraOverrides = [
        {
          matcher = {
            id = "byName";
            options = "host";
          };
          properties = [
            {
              id = "custom.hidden";
              value = true;
            }
          ];
        }
      ];
    })
  ];

  dashboard = {
    uid = "macro-firecracker-capacity";
    title = "Firecracker hosts: capacity";
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "computers"
      "capacity"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-6h";
      to = "now";
    };
    description = "How full each Firecracker host is and where its running VMs sit: fleet summary, one row per host, then each host's VMs. ${fleetHint} Watermarks are the defaults in docs/runbooks/computer-overcommit.md.";
    inherit links;
    templating.list = [
      {
        name = "env";
        label = "Environment";
        type = "query";
        inherit datasource;
        query = ''label_values(node_memory_MemTotal_bytes{job="firecracker-host/host"}, deployment_environment)'';
        refresh = 2;
        includeAll = true;
        allValue = ".*";
        multi = true;
        current = {
          text = "All";
          value = "$__all";
        };
      }
      {
        name = "host";
        label = "Host";
        type = "query";
        inherit datasource;
        query = ''label_values(node_memory_MemTotal_bytes{job="firecracker-host/host",deployment_environment=~"$env"}, host)'';
        refresh = 2;
        includeAll = true;
        allValue = ".*";
        multi = true;
        current = {
          text = "All";
          value = "$__all";
        };
      }
      {
        # Matched against the alias only, and kept out of the URL so an id
        # typed here is never shared with a link.
        name = "vm";
        label = "VM alias prefix";
        type = "textbox";
        skipUrlSync = true;
        query = "";
        current = {
          text = "";
          value = "";
        };
      }
      {
        name = "tile";
        label = "Tile metric";
        type = "custom";
        query = "cpu : 1,memory : 0";
        current = {
          text = "memory";
          value = "0";
        };
        options = [
          {
            text = "cpu";
            value = "1";
            selected = false;
          }
          {
            text = "memory";
            value = "0";
            selected = true;
          }
        ];
      }
    ];
    panels = [
      banner
      (row 5 3 "Fleet summary" { })
    ]
    ++ summary
    ++ nodes
    ++ [
      (
        text 3 "Not in Mimir yet" (pos 0 (nodeRowY + 26) 24 3)
          "**Scheduler capacity is not in Mimir.** The control plane's `computer.capacity.*` gauges and hibernated or stopped computer counts go to Datadog only, so this dashboard shows running VMs (they have a cgroup) and hosts, not what the scheduler would still place. Admission uses each host's own `hosted_runtime_host` watermarks; the 70 / 80 % lines here are the defaults. Per-computer detail: [Macro computers fleet](/d/macro-computers-fleet)."
        // {
          description = "What this dashboard can't show yet.";
        }
      )
    ]
    ++ map (
      p:
      p
      // {
        gridPos = p.gridPos // {
          y = p.gridPos.y + 3;
        };
      }
    ) vmRow;
  };
in
dashboard
