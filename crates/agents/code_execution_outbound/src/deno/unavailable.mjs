// The import map points every Node built-in outside deno.rs's NODE_ALLOWED
// here. A static import of one fails to link before this runs; the bootstrap
// gives that error the same message.
throw new Error("This Node module is unavailable in ExecuteCode. Make requests with fetch or the macro SDK.");
