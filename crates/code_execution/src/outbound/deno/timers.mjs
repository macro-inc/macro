// The import map points node timer and worker modules here; see bootstrap.mjs.
// The exports let named imports link, so evaluation reaches the throw.
export let setTimeout, setInterval, setImmediate, scheduler, promises, Worker;
export default undefined;
throw new Error("Timer and worker modules are unavailable in ExecuteCode: Custom timers are unsupported, including Promise.race deadline guards. The host already enforces the execution deadline (30 s by default in ExecuteCode). Use bounded batches with Promise.allSettled and return successful results with any failures before the deadline. Promise.allSettled does not add a timeout. To check back later, create a routine with macro.routines.create.");
