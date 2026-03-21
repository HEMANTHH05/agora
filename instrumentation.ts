// Next.js calls this file exactly once when the server process starts.
// This is the correct place to boot long-running background work.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run in the Node.js runtime (not the Edge runtime, not the browser)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSchema } = await import("./src/lib/db");
    await initSchema();
    const { startScheduler } = await import("./src/lib/scheduler");
    startScheduler();
  }
}
