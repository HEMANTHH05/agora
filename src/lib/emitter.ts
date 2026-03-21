import { EventEmitter } from "events";

// Global singleton — lives for the lifetime of the server process.
// The conversation engine emits events here; the SSE route listens and
// forwards them to connected browsers.

declare global {
  // eslint-disable-next-line no-var
  var __agoraEmitter: EventEmitter | undefined;
}

if (!global.__agoraEmitter) {
  global.__agoraEmitter = new EventEmitter();
  global.__agoraEmitter.setMaxListeners(50); // one per open browser tab
}

export const emitter = global.__agoraEmitter;

// ── Event types ────────────────────────────────────────────────────────────

export interface SessionStartEvent {
  type: "session_start";
  conversationId: number;
  topic: string;
  startedAt: string;       // ISO string
  durationSeconds: number; // always 150
}

export interface MessageEvent {
  type: "message";
  conversationId: number;
  agentId: string;
  agentName: string;
  content: string;
  timestamp: string;       // ISO string
  elapsedSeconds: number;
  remainingSeconds: number;
}

export interface SessionEndEvent {
  type: "session_end";
  conversationId: number;
  endedAt: string;         // ISO string
}

export type LiveEvent = SessionStartEvent | MessageEvent | SessionEndEvent;

// ── Helpers ────────────────────────────────────────────────────────────────

export function emitSessionStart(data: Omit<SessionStartEvent, "type">) {
  emitter.emit("live", { type: "session_start", ...data } as SessionStartEvent);
}

export function emitMessage(data: Omit<MessageEvent, "type">) {
  emitter.emit("live", { type: "message", ...data } as MessageEvent);
}

export function emitSessionEnd(data: Omit<SessionEndEvent, "type">) {
  emitter.emit("live", { type: "session_end", ...data } as SessionEndEvent);
}
