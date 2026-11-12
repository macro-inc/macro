# Loki panels over a report spec: a JSON file of filters and tables that a
# dashboard and scripts/ci-report.ts both read, so the two always agree.
# `statThresholds` colors a stat panel's columns by name.
{
  lib,
  report,
  statThresholds ? { },
}:
let
  loki = {
    type = "loki";
    uid = "loki";
  };
  # Longest names first, as the script does, so no name replaces part of another.
  filterNames = lib.sort (a: b: lib.stringLength a > lib.stringLength b) (
    builtins.attrNames report.filters
  );
  expand =
    range:
    builtins.replaceStrings ([ "$RANGE" ] ++ map (name: "$" + name) filterNames) (
      [ range ] ++ map (name: report.filters.${name}) filterNames
    );
  table = id: lib.findFirst (entry: entry.id == id) (throw "report has no table ${id}") report.tables;
  refId = index: builtins.elemAt (lib.stringToCharacters "ABCDEFGHIJ") index;
  grid = x: y: w: h: {
    inherit
      x
      y
      w
      h
      ;
  };
  # Grafana's "h" unit rolls over into days; CI hours should stay hours.
  grafanaUnit = unit: if unit == "h" then "suffix: h" else unit;
  unitOverride = name: unit: {
    matcher = {
      id = "byName";
      options = name;
    };
    properties = [
      {
        id = "unit";
        value = grafanaUnit unit;
      }
    ];
  };
  # One instant query per column over the dashboard's range, merged on the labels.
  instantTargets =
    entry:
    lib.imap0 (index: column: {
      refId = refId index;
      datasource = loki;
      expr = expand "$__range" column.expr;
      queryType = "instant";
      legendFormat = column.name;
    }) entry.columns;

  lokiTable =
    id: tableId: gridPos:
    let
      entry = table tableId;
    in
    {
      inherit id gridPos;
      inherit (entry) title description;
      type = "table";
      datasource = loki;
      targets = instantTargets entry;
      transformations = [
        {
          id = "merge";
          options = { };
        }
        {
          id = "organize";
          options = {
            excludeByName.Time = true;
            renameByName = lib.listToAttrs (
              lib.imap0 (index: column: lib.nameValuePair "Value #${refId index}" column.name) entry.columns
            );
            indexByName = lib.listToAttrs (lib.imap0 (index: label: lib.nameValuePair label index) entry.by);
          };
        }
      ]
      ++ lib.optional (entry ? sort) {
        id = "sortBy";
        options.sort = [
          {
            field = entry.sort;
            desc = true;
          }
        ];
      }
      ++ lib.optional (entry ? limit) {
        id = "limit";
        options.limitField = entry.limit;
      };
      fieldConfig = {
        # The default minimum column width hides the last columns of a half-width panel.
        defaults.custom.minWidth = 60;
        overrides = map (column: unitOverride column.name column.unit) entry.columns;
      };
      options = {
        showHeader = true;
        cellHeight = "sm";
      };
    };

  lokiStat =
    id: tableId: gridPos:
    let
      entry = table tableId;
    in
    {
      inherit id gridPos;
      inherit (entry) title description;
      type = "stat";
      datasource = loki;
      targets = instantTargets entry;
      fieldConfig = {
        defaults = {
          color = {
            mode = "fixed";
            fixedColor = "text";
          };
        };
        # Instant results carry no series name, so match each query by its refId.
        overrides = lib.imap0 (index: column: {
          matcher = {
            id = "byFrameRefID";
            options = refId index;
          };
          properties = [
            {
              id = "displayName";
              value = column.name;
            }
            {
              id = "unit";
              value = grafanaUnit column.unit;
            }
          ]
          ++ lib.optionals (statThresholds ? ${column.name}) [
            {
              id = "thresholds";
              value = statThresholds.${column.name};
            }
            {
              id = "color";
              value.mode = "thresholds";
            }
          ];
        }) entry.columns;
      };
      options = {
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
        colorMode = "value";
        graphMode = "none";
        textMode = "value_and_name";
        justifyMode = "center";
        # A narrow panel lists its values instead of squeezing them side by side.
        orientation = if gridPos.w < 12 then "horizontal" else "vertical";
      };
    };

  lokiSeries =
    id: gridPos: title: description: unit: interval: targets: extra:
    lib.recursiveUpdate {
      inherit
        id
        gridPos
        title
        description
        interval
        ;
      type = "timeseries";
      datasource = loki;
      maxDataPoints = 200;
      targets = lib.imap0 (
        index: target:
        target
        // {
          refId = refId index;
          datasource = loki;
          queryType = "range";
        }
      ) targets;
      fieldConfig.defaults = {
        inherit unit;
        custom = {
          spanNulls = true;
          showPoints = "never";
        };
      };
      options.legend = {
        displayMode = "list";
        placement = "bottom";
      };
    } extra;

  row = id: y: title: {
    inherit id title;
    type = "row";
    collapsed = false;
    gridPos = grid 0 y 24 1;
    panels = [ ];
  };
in
{
  inherit
    expand
    grid
    lokiSeries
    lokiStat
    lokiTable
    row
    ;
}
