undef $/; $_=<STDIN>;
my $t = "Math.round(performance.now())";
s/(      const claimed = await host\.claimNextMutation\(\n        owner,\n        now,\n        now \+ QUEUE_LEASE_MS\n      \);\n)/$1      console.log('DBGq claim', $t, owner.slice(-6), claimed ? claimed.transactionId + ' ' + claimed.operationName : 'none', 'deferredUntil', deferredUntil === undefined ? '-' : deferredUntil - now);\n/ or die 1;
s/(    const \[blocked\] = await host\.inspectMutations\(\);\n)/$1    console.log('DBGq blocked', $t, JSON.stringify(blocked ? { id: blocked.transactionId, op: blocked.operationName, lo: blocked.leaseOwner?.slice(-6), exp: blocked.leaseExpiresAtMs === undefined ? null : blocked.leaseExpiresAtMs - now, alive: blocked.leaseOwner ? await liveness.isAlive(blocked.leaseOwner) : null, keys: Object.keys(blocked) } : null));\n/ or die 2;
s/(    \} catch \{\n      telemetry\.skipped\('claim-failed'\);)/    } catch (dbgError) {\n      console.log('DBGq claim-failed', $t, String(dbgError));\n      telemetry.skipped('claim-failed');/ or die 3;
s/(      if \(!settled && isCurrent\(attempt\)\) \{\n        retryAt = Date\.now\(\) \+ QUEUE_LEASE_MS;)/      console.log('DBGq settle-threw', $t, String(error), (error as Error)?.stack?.slice(0, 600));\n$1/ or die 4;
s/(      attemptTelemetry\.finish\(outcome, details\);)/      console.log('DBGq finish', $t, attempt.mutation?.operationName, outcome, JSON.stringify(details), 'retryIn', retryAt === undefined ? '-' : retryAt - Date.now());\n$1/ or die 5;
print;
