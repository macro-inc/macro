---
name: qc-disable
description: Disable automatic QC checks for this machine
allowed-tools: Bash
---

Disable QC checks by setting the local config:

```bash
echo "qc_disabled=true" > .claude/.local
```

Confirm: "QC checks disabled. Run /qc-enable to re-enable."
