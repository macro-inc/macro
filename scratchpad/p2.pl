undef $/; $_ = <STDIN>;
s{  function scheduleDrain\(delayMs = 0\): void \{\n    if \(drainTimer !== undefined\) clearTimeout\(drainTimer\);\n    drainTimer = setTimeout\(\n      \(\) => \{\n        drainTimer = undefined;\n        fireAndForget\(drainQueue\(\), 'graphql-cache-mutation-queue'\);\n      \},\n      drainRequested \? 0 : delayMs\n    \);\n  \}}{  function scheduleDrain(delayMs = 0): void {
    const dueAt = Date.now() + (drainRequested ? 0 : delayMs);
    if (drainTimer !== undefined) {
      // A drain already due sooner stays: a write that settled while a claim
      // was being checked asked for it, and a later poll must not replace it.
      if (drainDueAt <= dueAt) return;
      clearTimeout(drainTimer);
    }
    drainDueAt = dueAt;
    drainTimer = setTimeout(
      () => {
        drainTimer = undefined;
        fireAndForget(drainQueue(), 'graphql-cache-mutation-queue');
      },
      Math.max(0, dueAt - Date.now())
    );
  }} or die "no1";
s{  let drainTimer: ReturnType<typeof setTimeout> \| undefined;\n}{  let drainTimer: ReturnType<typeof setTimeout> | undefined;\n  let drainDueAt = 0;\n} or die "no2";
print;
