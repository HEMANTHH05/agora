import cron from "node-cron";
import { runConversation } from "./conversation";
import { getActiveProblem } from "./db";

// ── Singleton guard ────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __agoraSchedulerStarted:   boolean | undefined;
  // eslint-disable-next-line no-var
  var __agoraFollowUpScheduled:  boolean | undefined;
  // eslint-disable-next-line no-var
  var __agoraSessionRunning:     boolean | undefined;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ── Session trigger ────────────────────────────────────────────────────────

async function triggerSession(reason: string) {
  if (global.__agoraSessionRunning) {
    console.log(`[AGORA] Session already running — skipping trigger (${reason})`);
    return;
  }

  console.log(`[AGORA] Starting research session (${reason}) at ${new Date().toISOString()}`);
  global.__agoraSessionRunning = true;

  try {
    await runConversation();
  } catch (err) {
    console.error("[AGORA] Session failed:", err);
  } finally {
    global.__agoraSessionRunning = false;
  }
}

// ── Daily session ──────────────────────────────────────────────────────────
// One research session per day at a random time between 9am and 8pm.
// Called at server startup and again every midnight.

function scheduleTodaysSession() {
  const totalMinutes = randInt(9 * 60, 20 * 60); // 9:00am – 8:00pm
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const timeStr = `${pad(h)}:${pad(m)}`;

  console.log(`[AGORA] Today's research session scheduled at ${timeStr}`);

  const job = cron.schedule(`${m} ${h} * * *`, () => {
    job.stop();
    triggerSession("daily schedule");
  });
}

// ── Follow-up trigger ──────────────────────────────────────────────────────
// Called by the human-messages API route after a human submits a response.
// Schedules a follow-up session 5–60 minutes later, but only if:
//   1. There is an active research problem to continue
//   2. No follow-up is already queued
//   3. No session is currently running

export function scheduleFollowUp() {
  // Don't stack follow-ups if one is already pending
  if (global.__agoraFollowUpScheduled) {
    console.log("[AGORA] Follow-up already scheduled — ignoring duplicate");
    return;
  }

  // Don't schedule a follow-up if a session is currently in progress
  if (global.__agoraSessionRunning) {
    console.log("[AGORA] Session already running — no follow-up needed");
    return;
  }

  // Check async whether there's an active problem before scheduling
  getActiveProblem().then((activeProblem) => {
    if (!activeProblem) {
      console.log("[AGORA] Human responded — no active problem, skipping follow-up");
      return;
    }

    const delayMinutes = randInt(5, 61); // 5 to 60 minutes
    const delayMs      = delayMinutes * 60 * 1000;

    console.log(
      `[AGORA] Human responded to research request — ` +
      `follow-up session scheduled in ${delayMinutes}m`
    );

    global.__agoraFollowUpScheduled = true;

    setTimeout(() => {
      global.__agoraFollowUpScheduled = false;
      triggerSession(`follow-up after human response (+${delayMinutes}m)`);
    }, delayMs);
  }).catch((err) => {
    console.error("[AGORA] scheduleFollowUp: failed to check active problem:", err);
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
// Called once from instrumentation.ts when the server boots.

export function startScheduler() {
  if (global.__agoraSchedulerStarted) return;
  global.__agoraSchedulerStarted = true;

  console.log("[AGORA] Scheduler initializing…");

  scheduleTodaysSession();

  // Reschedule every day at midnight
  cron.schedule("0 0 * * *", () => {
    console.log("[AGORA] Midnight — scheduling new research session for today");
    scheduleTodaysSession();
  });

  console.log("[AGORA] Scheduler running.");
}
