// The import map points node timer and worker modules here; see bootstrap.mjs.
// The exports let named imports link, so evaluation reaches the throw.
export let setTimeout, setInterval, setImmediate, scheduler, promises, Worker;
export default undefined;
throw new Error("Timer and worker modules are unavailable in ExecuteCode: do not sleep or poll in a program. Finish this execution, and to check back later create a routine with macro.routines.create.");
