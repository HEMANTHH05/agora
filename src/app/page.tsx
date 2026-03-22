"use client";

import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

interface DateEntry {
  date: string;
  count: number;
}

interface Message {
  agentId: string;
  agentName: string;
  agentRole?: string;
  content: string;
  timestamp: string;
  elapsedSeconds: number;
  remainingSeconds: number;
}

interface Session {
  id: number;
  date: string;
  session_type: number;
  session_status: string | null;
  session_number: number;
  topic: string;
  started_at: string;
  ended_at: string | null;
  messages: Message[];
}

interface LiveSession {
  conversationId: number;
  topic: string;
  startedAt: string;
  durationSeconds: number;
}

interface HumanMessage {
  id: number;
  conversation_id: number;
  date: string;
  agent_id: string;
  agent_name: string;
  request: string;
  request_type: string | null;
  response: string | null;
  reaction: string | null;
  created_at: string;
  responded_at: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  quinn: "#a8a8a8",
  eva:   "#7eb8f7",
  sol:   "#f7c77e",
  vera:  "#a8f7b8",
};

const ALL_AGENTS = ["quinn", "eva", "sol", "vera"];

const AGENT_ROLES: Record<string, string> = {
  quinn: "Question Framing",
  eva:   "Evidence Retrieval",
  sol:   "Hypothesis & Solutions",
  vera:  "Critic & Verifier",
};

const BADGE_COLORS: Record<string, string> = {
  DATA_REQUEST:  "#7eb8f7",
  CLARIFICATION: "#a8a8a8",
  VALIDATION:    "#f7c77e",
};

// ── Utility ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Small components ───────────────────────────────────────────────────────

function Dot({ color, size = 7, glow = false }: { color: string; size?: number; glow?: boolean }) {
  return (
    <span style={{
      display: "inline-block",
      width: size, height: size,
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
      boxShadow: glow ? `0 0 6px ${color}` : "none",
    }} />
  );
}

function Divider({ margin = "4px 0" }: { margin?: string }) {
  return <div style={{ height: 1, background: "var(--border)", margin }} />;
}

// ── Intro Splash ───────────────────────────────────────────────────────────

// Terminal sequence definition: each entry is a line to type, with its
// delay BEFORE typing starts (after the previous line finishes), char speed,
// and visual style.
interface TermLine {
  text:    string;
  delay:   number; // ms pause before this line starts typing
  speed:   number; // ms per character
  style:   React.CSSProperties;
  instant?: boolean; // skip typing, appear all at once (for title)
}

const TERM_LINES: TermLine[] = [
  {
    text: "AGORA",
    delay: 120,
    speed: 70,
    style: {
      fontSize: 48, fontWeight: 700, letterSpacing: "0.35em",
      color: "#ffffff", fontFamily: "'Courier New', Courier, monospace",
      marginBottom: 8, lineHeight: 1.1,
    },
  },
  {
    text: "AI RESEARCH UNIVERSITY",
    delay: 400,
    speed: 38,
    style: {
      fontSize: 11, letterSpacing: "0.22em", color: "#555",
      fontFamily: "'Courier New', Courier, monospace",
      textTransform: "uppercase", marginBottom: 36,
    },
  },
  {
    text: "Initializing autonomous research agents...",
    delay: 600,
    speed: 28,
    style: {
      fontSize: 12, color: "#4a4a4a",
      fontFamily: "'Courier New', Courier, monospace", marginBottom: 4,
    },
  },
  {
    text: "4 agents online.",
    delay: 300,
    speed: 32,
    style: {
      fontSize: 12, color: "#4ade80",
      fontFamily: "'Courier New', Courier, monospace", marginBottom: 4,
    },
  },
  {
    text: "Current research problem loaded.",
    delay: 300,
    speed: 32,
    style: {
      fontSize: 12, color: "#4ade80",
      fontFamily: "'Courier New', Courier, monospace", marginBottom: 28,
    },
  },
  {
    text: "Four autonomous AI agents working in concert — framing questions, retrieving evidence, building hypotheses, and stress-testing every conclusion. No human directs the research.",
    delay: 500,
    speed: 22,
    style: {
      fontSize: 13, color: "#888", lineHeight: 1.7,
      fontFamily: "'Courier New', Courier, monospace",
      maxWidth: 560, marginBottom: 0,
    },
  },
];

function IntroSplash({ onEnter }: { onEnter: () => void }) {
  // `lines[i]` = how many characters of line i have been typed so far
  const [typed, setTyped]         = useState<number[]>(TERM_LINES.map(() => 0));
  const [lineVisible, setVisible] = useState<boolean[]>(TERM_LINES.map(() => false));
  const [showPrompt, setShowPrompt] = useState(false);
  const [exiting, setExiting]     = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleEnter() {
    if (!showPrompt) return;
    setExiting(true);
    setTimeout(onEnter, 700);
  }

  // Keyboard Enter listener
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") handleEnter();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPrompt]);

  // Drive the typewriter sequence
  useEffect(() => {
    let cancelled = false;

    async function sleep(ms: number) {
      return new Promise<void>((res) => {
        timerRef.current = setTimeout(res, ms);
      });
    }

    async function run() {
      for (let i = 0; i < TERM_LINES.length; i++) {
        const line = TERM_LINES[i];
        await sleep(line.delay);
        if (cancelled) return;

        // Mark line as visible (so it renders with empty text + cursor)
        setVisible((prev) => { const n = [...prev]; n[i] = true; return n; });

        // Type characters one by one
        for (let c = 1; c <= line.text.length; c++) {
          await sleep(line.speed);
          if (cancelled) return;
          setTyped((prev) => { const n = [...prev]; n[i] = c; return n; });
        }
      }
      // All lines done — show the prompt after a final pause
      await sleep(800);
      if (!cancelled) setShowPrompt(true);
    }

    run();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <>
      {/* Blinking cursor / glow keyframes */}
      <style>{`
        @keyframes termBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes promptGlow {
          0%, 100% { box-shadow: 0 0 0px rgba(255,255,255,0); }
          50% { box-shadow: 0 0 14px rgba(255,255,255,0.18); }
        }
      `}</style>

      <div
        style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "#0a0a0a",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: exiting ? 0 : 1,
          transition: exiting ? "opacity 0.7s ease" : "none",
        }}
      >
        <div style={{ width: "100%", maxWidth: 560, padding: "0 32px" }}>

          {TERM_LINES.map((line, i) => (
            <div key={i} style={{ ...line.style, display: lineVisible[i] ? "block" : "none" }}>
              {line.text.slice(0, typed[i])}
              {/* Show blinking block cursor on the line currently being typed */}
              {lineVisible[i] && typed[i] < line.text.length && (
                <span style={{
                  display: "inline-block",
                  width: "0.55em", height: "1em",
                  background: "#4ade80",
                  marginLeft: 1,
                  verticalAlign: "text-bottom",
                  animation: "termBlink 0.8s step-end infinite",
                }} />
              )}
            </div>
          ))}

          {/* [ ENTER ] prompt */}
          {showPrompt && (
            <div style={{ marginTop: 36 }}>
              <button
                onClick={handleEnter}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.35)",
                  borderRadius: 3,
                  color: "#ffffff",
                  fontFamily: "'Courier New', Courier, monospace",
                  fontSize: 13, letterSpacing: "0.14em",
                  padding: "9px 22px",
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 8,
                  animation: "promptGlow 2s ease-in-out infinite",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget).style.borderColor = "rgba(255,255,255,0.75)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget).style.borderColor = "rgba(255,255,255,0.35)";
                }}
              >
                [ ENTER ]
                <span style={{
                  display: "inline-block",
                  width: "0.55em", height: "1em",
                  background: "#4ade80",
                  verticalAlign: "text-bottom",
                  animation: "termBlink 0.8s step-end infinite",
                }} />
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

// ── About Panel ────────────────────────────────────────────────────────────

function AboutPanel({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay so the CSS transition fires after mount
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 350);
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 100,
      display: "flex", justifyContent: "flex-end",
      pointerEvents: "none",
    }}>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.5)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.35s ease",
          pointerEvents: visible ? "auto" : "none",
          cursor: "default",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "relative", zIndex: 1,
        width: 480, height: "100%",
        background: "#0e0e0e",
        borderLeft: "1px solid var(--border)",
        overflowY: "auto",
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.35s cubic-bezier(0.4,0,0.2,1)",
        pointerEvents: "auto",
      }}>
        {/* Header */}
        <div style={{
          position: "sticky", top: 0, zIndex: 2,
          padding: "20px 28px 16px",
          borderBottom: "1px solid var(--border)",
          background: "#0e0e0e",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text)" }}>
              ABOUT
            </div>
            <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2, letterSpacing: "0.04em" }}>
              AGORA AI RESEARCH UNIVERSITY
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: "none", border: "none",
              color: "var(--text-faint)", fontSize: 18,
              cursor: "pointer", padding: "4px 8px", lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "32px 28px 48px", display: "flex", flexDirection: "column", gap: 36 }}>

          <AboutSection title="PROTOTYPE NOTE">
            AGORA is a research prototype. It is not a finished product. It exists to study how
            AI agents behave when given long-running, open-ended research tasks with minimal
            human intervention. Expect rough edges. The agents sometimes go in circles, ask
            unnecessary questions, or reach shallow conclusions. That is part of what we are
            learning to fix.
          </AboutSection>

          <AboutSection title="WHAT IS AGORA">
            AGORA is an autonomous AI research platform where four specialized agents collaborate
            on open-ended research problems without human direction. Each agent has a permanent
            role: Quinn frames the research question, Eva retrieves real evidence from the web,
            Sol proposes hypotheses and solutions, and Vera attacks every conclusion until only
            what holds remains.
          </AboutSection>

          <AboutSection title="HOW IT WORKS">
            <ul style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <li>Research sessions run automatically once per day</li>
              <li>Each session lasts 10 minutes — agents pick up exactly where they left off</li>
              <li>Problems persist across days until fully resolved</li>
              <li>When Vera declares a breakthrough, it moves to Achievements</li>
              <li>Agents build memory over time — each session they remember what they learned before</li>
            </ul>
          </AboutSection>

          <AboutSection title="CURRENT STATUS">
            This is an early-stage prototype built to study autonomous agent orchestration,
            research workflows, and real-world token costs. Sessions are capped at 10 minutes.
            The agent count is fixed at 4. API costs are intentionally limited — this demo
            exists to understand how multi-agent systems behave over time when given a persistent
            research mandate, not to produce publication-ready research. We are watching what
            emerges.
          </AboutSection>

          <AboutSection title="THE STACK">
            Built with Next.js, Claude (Anthropic), GPT-4o-mini (OpenAI), Tavily web search, and
            PostgreSQL on Supabase stores all conversations, agent memories, and research state — persisted across sessions. Agent orchestration is hand-coded — no frameworks. The entire system is ~1,500
            lines of TypeScript.
          </AboutSection>

          <AboutSection title="WHAT'S NEXT">
            Longer sessions. More agents with specialized domain knowledge. Agent-to-agent memory
            sharing. The ability for agents to write and run actual code. A public research feed.
          </AboutSection>

          {/* Agent cards */}
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 16,
            }}>
              THE RESEARCHERS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { id: "quinn", name: "Quinn", role: "Question Framing",
                  desc: "Turns vague problems into precisely researchable questions. Speaks first. Refuses to let research drift from its original mandate." },
                { id: "eva", name: "Eva", role: "Evidence Retrieval",
                  desc: "Runs live web searches before each turn. Reports only what exists — cites sources, flags contradictions, surfaces gaps." },
                { id: "sol", name: "Sol", role: "Hypothesis & Solutions",
                  desc: "Proposes at least three meaningfully distinct approaches per turn. Writes actual math and pseudocode, not descriptions of them." },
                { id: "vera", name: "Vera", role: "Critic & Verifier",
                  desc: "Attacks every proposal for logical inconsistency, hidden assumptions, and failure cases. The only agent who can declare research resolved." },
              ].map((a) => (
                <div key={a.id} style={{
                  padding: "12px 14px",
                  border: "1px solid var(--border)",
                  borderLeft: `3px solid ${ACCENT[a.id]}`,
                  borderRadius: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Dot color={ACCENT[a.id]} size={7} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT[a.id] }}>{a.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)" }}>· {a.role}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
                    {a.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div id="contact-section">
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12,
            }}>
              CONTACT
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.8, marginBottom: 16 }}>
              Built and maintained by Hemanth K. If you have questions, research ideas, or want to
              collaborate on autonomous agent systems — reach out.
            </div>
            <div style={{
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Hemanth K</span>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Builder &amp; Researcher</span>
              <a
                href="mailto:hemanthdpk@gmail.com"
                style={{
                  fontSize: 13, color: "#a8a8a8",
                  textDecoration: "none", cursor: "pointer", marginTop: 2,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
              >
                hemanthdpk@gmail.com
              </a>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function AboutSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
        color: "var(--text-faint)", textTransform: "uppercase",
        marginBottom: 12,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function Home() {
  // Intro splash — check sessionStorage to skip on return visits
  const [showIntro, setShowIntro] = useState(false);
  const [appVisible, setAppVisible] = useState(false);

  useEffect(() => {
    const seen = sessionStorage.getItem("agora_intro_seen");
    if (seen) {
      setAppVisible(true);
    } else {
      setShowIntro(true);
    }
  }, []);

  function handleEnter() {
    sessionStorage.setItem("agora_intro_seen", "1");
    setShowIntro(false);
    setAppVisible(true);
  }

  const [view, setView] = useState<"archive" | "live">("archive");
  const [showAbout, setShowAbout] = useState(false);

  // Mobile-specific state
  const [mobileTab, setMobileTab] = useState<"archive" | "live" | "inbox">("archive");
  const [mobileSessionOpen, setMobileSessionOpen] = useState(false);

  // Archive
  const [dates, setDates]                     = useState<DateEntry[]>([]);
  const [selectedDate, setSelectedDate]       = useState<string | null>(null);
  const [sessions, setSessions]               = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [achievements, setAchievements]       = useState<Session[]>([]);

  // Live
  const [liveSession, setLiveSession]   = useState<LiveSession | null>(null);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [liveElapsed, setLiveElapsed]   = useState(0);

  // Typing animation
  const [animatingIdx, setAnimatingIdx] = useState<number | null>(null);
  const [wordCount, setWordCount]       = useState(0);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Human inbox
  const [humanMessages, setHumanMessages]     = useState<HumanMessage[]>([]);
  const [draftResponses, setDraftResponses]   = useState<Record<number, string>>({});
  const [submitting, setSubmitting]           = useState<number | null>(null);
  const [injecting, setInjecting]             = useState(false);

  // Misc
  const liveBottomRef = useRef<HTMLDivElement>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const [triggering, setTriggering]     = useState(false);
  const [runsRemaining, setRunsRemaining] = useState<number | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────────

  async function fetchDates() {
    const res = await fetch("/api/conversations");
    const data: DateEntry[] = await res.json();
    setDates(data);
    return data;
  }

  async function selectDate(date: string) {
    setSelectedDate(date);
    setSelectedSession(null);
    const res = await fetch(`/api/conversations?date=${date}`);
    const data: Session[] = await res.json();
    setSessions(data);
  }

  async function fetchAchievements() {
    const datesRes = await fetch("/api/conversations");
    const allDates: DateEntry[] = await datesRes.json();
    if (allDates.length === 0) { setAchievements([]); return; }
    const all = await Promise.all(
      allDates.map(async (d) => {
        const r = await fetch(`/api/conversations?date=${d.date}`);
        return r.json() as Promise<Session[]>;
      })
    );
    setAchievements(all.flat().filter((s) => s.session_status === "ACHIEVEMENT"));
  }

  async function fetchHumanMessages() {
    const res = await fetch("/api/human-messages");
    const data: HumanMessage[] = await res.json();
    setHumanMessages(data);
  }

  async function fetchRunsRemaining() {
    const res = await fetch("/api/trigger");
    const data = await res.json();
    setRunsRemaining(data.remaining ?? 0);
  }

  useEffect(() => {
    fetchDates().then((data) => { if (data.length > 0) selectDate(data[0].date); });
    fetchAchievements();
    fetchHumanMessages();
    fetchRunsRemaining();

    const poll = setInterval(fetchHumanMessages, 30_000);
    return () => clearInterval(poll);
  }, []);

  // ── Typing animation ──────────────────────────────────────────────────────

  useEffect(() => {
    if (liveMessages.length === 0) return;
    const newIdx = liveMessages.length - 1;
    const words  = liveMessages[newIdx].content.split(" ");
    if (animRef.current) clearInterval(animRef.current);
    setAnimatingIdx(newIdx);
    setWordCount(0);
    let count = 0;
    animRef.current = setInterval(() => {
      count++;
      setWordCount(count);
      if (count >= words.length) {
        clearInterval(animRef.current!);
        animRef.current = null;
        setAnimatingIdx(null);
      }
    }, 80);
  }, [liveMessages.length]);

  // ── SSE ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource("/api/live");

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);

      if (event.type === "session_start") {
        if (timerRef.current) clearInterval(timerRef.current);
        if (animRef.current)  clearInterval(animRef.current);
        setAnimatingIdx(null);
        setWordCount(0);
        setLiveMessages([]);
        setLiveElapsed(0);
        setLiveSession({
          conversationId:  event.conversationId,
          topic:           event.topic,
          startedAt:       event.startedAt,
          durationSeconds: event.durationSeconds,
        });
        const startMs = Date.now();
        timerRef.current = setInterval(() => {
          const secs = Math.floor((Date.now() - startMs) / 1000);
          setLiveElapsed(secs);
          if (secs >= event.durationSeconds) clearInterval(timerRef.current!);
        }, 1000);
        setView("live");
        setMobileTab("live");
      }

      if (event.type === "message") {
        setLiveMessages((prev) => [...prev, event as Message]);
        setTimeout(() => liveBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }

      if (event.type === "session_end") {
        if (timerRef.current) clearInterval(timerRef.current);
        setLiveSession(null);
        fetchDates().then((data) => {
          const today = format(new Date(), "yyyy-MM-dd");
          if (data.some((d) => d.date === today)) selectDate(today);
        });
        fetchAchievements();
        fetchHumanMessages();
      }
    };

    return () => {
      es.close();
      if (timerRef.current) clearInterval(timerRef.current);
      if (animRef.current)  clearInterval(animRef.current);
    };
  }, []);

  // ── Trigger ───────────────────────────────────────────────────────────────

  async function triggerSession() {
    if (runsRemaining !== null && runsRemaining <= 0) return;
    setTriggering(true);
    try {
      const res = await fetch("/api/trigger", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setRunsRemaining(data.remaining ?? 0);
        setView("live");
      } else {
        // 429 — limit reached, refresh count
        await fetchRunsRemaining();
      }
    } finally {
      setTimeout(() => setTriggering(false), 2000);
    }
  }

  // ── Inbox ─────────────────────────────────────────────────────────────────

  async function submitResponse(id: number) {
    const response = draftResponses[id]?.trim();
    if (!response) return;
    setSubmitting(id);
    try {
      await fetch("/api/human-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, response }),
      });
      setDraftResponses((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (liveSession !== null) {
        setInjecting(true);
        setTimeout(() => setInjecting(false), 3000);
      }
      await fetchHumanMessages();
    } finally {
      setSubmitting(null);
    }
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  function resolveContent(msg: Message, idx: number): string {
    if (idx === animatingIdx) return msg.content.split(" ").slice(0, wordCount).join(" ");
    return msg.content;
  }

  function followedHumanInput(messages: Message[], idx: number): boolean {
    if (idx === 0) return false;
    const prev = messages[idx - 1];
    const curr = messages[idx];
    return humanMessages.some(
      (hm) =>
        hm.responded_at !== null &&
        hm.responded_at > prev.timestamp &&
        hm.responded_at <= curr.timestamp
    );
  }

  const liveProgress  = liveSession ? Math.min(liveElapsed / liveSession.durationSeconds, 1) : 0;
  const liveRemaining = liveSession ? Math.max(liveSession.durationSeconds - liveElapsed, 0) : 0;

  const pendingInbox  = humanMessages.filter((m) => !m.responded_at);
  const resolvedInbox = humanMessages.filter((m) =>  m.responded_at);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Responsive styles */}
      <style>{`
        .desktop-layout { display: flex !important; }
        .mobile-layout  { display: none   !important; }
        @media (max-width: 767px) {
          .desktop-layout { display: none  !important; }
          .mobile-layout  { display: flex  !important; }
        }
        .mobile-layout textarea { -webkit-appearance: none; }
        .mobile-nav-btn { position: relative; }
      `}</style>

      {/* Intro splash */}
      {showIntro && <IntroSplash onEnter={handleEnter} />}

      {/* Main app — desktop (768px+) */}
      <div className="desktop-layout" style={{
        height: "100vh", overflow: "hidden",
        opacity: appVisible ? 1 : 0,
        transition: "opacity 0.6s ease",
        position: "relative",
      }}>

        {/* ── Sidebar (210px) ─────────────────────────────────────────────── */}
        <aside style={{
          width: 210, display: "flex", flexDirection: "column",
          borderRight: "1px solid var(--border)", flexShrink: 0,
        }}>
          {/* Logo */}
          <div style={{ padding: "20px 18px 16px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text)" }}>
              AGORA
            </div>
            <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 3, letterSpacing: "0.04em" }}>
              AI RESEARCH UNIVERSITY
            </div>
          </div>

          <Divider />

          {/* Researchers */}
          <div style={{ padding: "10px 18px 8px" }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
              color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8,
            }}>
              Researchers
            </div>
            {[
              { id: "quinn", name: "Quinn", role: "Question Framing" },
              { id: "eva",   name: "Eva",   role: "Evidence Retrieval" },
              { id: "sol",   name: "Sol",   role: "Hypothesis & Solutions" },
              { id: "vera",  name: "Vera",  role: "Critic & Verifier" },
            ].map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <Dot color={ACCENT[a.id]} size={6} />
                <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>{a.name}</span>
                <span style={{ fontSize: 10, color: "var(--text-faint)" }}>· {a.role}</span>
              </div>
            ))}
          </div>

          {/* About + Contact buttons */}
          <div style={{ padding: "0 12px 6px", display: "flex", flexDirection: "column", gap: 5 }}>
            <button
              onClick={() => setShowAbout(true)}
              style={{
                width: "100%", padding: "7px 10px",
                background: "var(--card)",
                border: "1px solid var(--border-mid, #333)",
                borderRadius: 4,
                color: "var(--text-dim)",
                fontSize: 11, letterSpacing: "0.06em",
                textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 7,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.25)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-mid, #333)";
              }}
            >
              <span style={{
                fontSize: 11, lineHeight: 1,
                color: "var(--text-faint)",
                border: "1px solid var(--text-faint)",
                borderRadius: "50%",
                width: 14, height: 14,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>i</span>
              About
            </button>
            <button
              onClick={() => {
                setShowAbout(true);
                setTimeout(() => {
                  document.getElementById("contact-section")?.scrollIntoView({ behavior: "smooth" });
                }, 400);
              }}
              style={{
                width: "100%", padding: "7px 10px",
                background: "var(--card)",
                border: "1px solid var(--border-mid, #333)",
                borderRadius: 4,
                color: "var(--text-dim)",
                fontSize: 11, letterSpacing: "0.06em",
                textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 7,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.25)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-mid, #333)";
              }}
            >
              <span style={{
                fontSize: 11, lineHeight: 1,
                color: "var(--text-faint)",
                border: "1px solid var(--text-faint)",
                borderRadius: "50%",
                width: 14, height: 14,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>@</span>
              Contact
            </button>
          </div>

          <Divider />

          {/* Nav tabs */}
          <div style={{ padding: "8px 8px" }}>
            {(["archive", "live"] as const).map((tab) => (
              <button key={tab} onClick={() => setView(tab)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "7px 10px",
                background: view === tab ? "var(--card)" : "transparent",
                border: "none", borderRadius: 5,
                color: view === tab ? "var(--text)" : "var(--text-dim)",
                fontSize: 13, fontWeight: view === tab ? 500 : 400,
                textAlign: "left", marginBottom: 1, cursor: "pointer",
              }}>
                {tab === "live" && (
                  <Dot
                    color={liveSession ? "#4ade80" : "var(--text-faint)"}
                    size={6}
                    glow={!!liveSession}
                  />
                )}
                {tab === "archive" ? "Archive" : "Live"}
              </button>
            ))}
          </div>

          <Divider />

          {/* Date list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {dates.length === 0 ? (
              <div style={{ padding: "14px 18px", fontSize: 12, color: "var(--text-faint)" }}>
                No sessions yet
              </div>
            ) : dates.map((d) => {
              const active = selectedDate === d.date && view === "archive";
              return (
                <button key={d.date}
                  onClick={() => { setView("archive"); selectDate(d.date); }}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    width: "100%", padding: "7px 18px",
                    background: active ? "var(--card)" : "transparent",
                    border: "none", color: active ? "var(--text)" : "var(--text-dim)",
                    fontSize: 13, textAlign: "left", cursor: "pointer",
                  }}
                >
                  <span>{format(parseISO(d.date), "MMM d")}</span>
                  <span style={{ fontSize: 11, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                    {d.count}
                  </span>
                </button>
              );
            })}
          </div>

          <Divider />

          {/* Trigger */}
          {(() => {
            const limitReached = runsRemaining !== null && runsRemaining <= 0;
            const disabled = triggering || limitReached;
            return (
              <div style={{ padding: "10px 12px 14px" }}>
                <button
                  onClick={triggerSession}
                  disabled={disabled}
                  style={{
                    width: "100%", padding: "8px 0",
                    background: "transparent", border: "1px solid var(--border-mid)",
                    borderRadius: 5,
                    color: disabled ? "var(--text-faint)" : "var(--text-dim)",
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  {triggering ? "Starting…" : limitReached ? "No Runs Left Today" : "Run Research"}
                </button>
                <div style={{
                  fontSize: 10, color: "var(--text-faint)", marginTop: 5,
                  textAlign: "center", letterSpacing: "0.02em",
                }}>
                  {runsRemaining === null
                    ? ""
                    : limitReached
                      ? "Resets at midnight"
                      : `${runsRemaining} of 5 runs remaining today`}
                </div>
              </div>
            );
          })()}
        </aside>

        {/* ── Session list (250px) ────────────────────────────────────────── */}
        <div style={{
          width: 250, display: "flex", flexDirection: "column",
          borderRight: "1px solid var(--border)", flexShrink: 0, overflowY: "auto",
        }}>

          {/* Achievements */}
          <div style={{ flexShrink: 0 }}>
            <div style={{ padding: "14px 14px 6px", display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#a8f7b8", textTransform: "uppercase" }}>
                ✦ Achievements
              </span>
              {achievements.length > 0 && (
                <span style={{
                  fontSize: 10, color: "var(--text-faint)",
                  background: "var(--border)", borderRadius: 8, padding: "1px 6px",
                }}>
                  {achievements.length}
                </span>
              )}
            </div>

            {achievements.length === 0 ? (
              <div style={{ padding: "2px 14px 12px", fontSize: 11, color: "var(--text-faint)" }}>
                No breakthroughs yet
              </div>
            ) : achievements.map((s) => {
              const active = selectedSession?.id === s.id;
              return (
                <button key={s.id}
                  onClick={() => { setSelectedSession(s); setView("archive"); }}
                  style={{
                    display: "block", width: "100%", padding: "10px 14px",
                    background: active ? "#0d1a0d" : "transparent", border: "none",
                    borderLeft: active ? "2px solid #a8f7b8" : "2px solid transparent",
                    textAlign: "left", cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "#a8f7b8", fontWeight: 600 }}>✦ RESOLVED</span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
                      {format(parseISO(s.date), "MMM d")}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12, color: active ? "var(--text)" : "var(--text-dim)",
                    lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical", overflow: "hidden",
                  }}>
                    {s.topic}
                  </div>
                </button>
              );
            })}
          </div>

          <Divider margin="0" />

          {/* Date header */}
          <div style={{ padding: "12px 14px 6px", flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-dim)" }}>
              {selectedDate ? format(parseISO(selectedDate), "EEEE, MMMM d") : "Select a date"}
            </div>
          </div>

          {/* Sessions for selected date */}
          {sessions.length === 0 ? (
            <div style={{ padding: "4px 14px 12px", fontSize: 11, color: "var(--text-faint)" }}>
              No sessions on this date
            </div>
          ) : sessions.map((s) => {
            const active   = selectedSession?.id === s.id;
            const resolved = s.session_status === "ACHIEVEMENT";
            const running  = !s.ended_at;
            return (
              <button key={s.id} onClick={() => { setSelectedSession(s); setView("archive"); }} style={{
                display: "block", width: "100%", padding: "12px 14px",
                background: active ? "var(--card)" : "transparent", border: "none",
                borderLeft: active ? "2px solid var(--text-faint)" : "2px solid transparent",
                textAlign: "left", cursor: "pointer",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 10, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                    {format(parseISO(s.started_at), "h:mm a")}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    color: resolved ? "#a8f7b8" : running ? "#4ade80" : "var(--text-faint)",
                  }}>
                    {resolved ? "✦ RESOLVED" : running ? "● LIVE" : "ONGOING"}
                  </span>
                </div>
                {s.session_number > 1 && (
                  <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 4 }}>
                    Session {s.session_number} of ongoing research
                  </div>
                )}
                <div style={{
                  fontSize: 12, color: active ? "var(--text)" : "var(--text-dim)",
                  lineHeight: 1.45, marginBottom: 8,
                  display: "-webkit-box", WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {s.topic}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {ALL_AGENTS.map((id) => <Dot key={id} color={ACCENT[id]} size={5} />)}
                  </div>
                  <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
                    {s.messages.length} msgs
                  </span>
                </div>
              </button>
            );
          })}

          <div style={{ height: 16, flexShrink: 0 }} />
        </div>

        {/* ── Conversation / Live (flex 1) — relative so About panel anchors to it */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, position: "relative" }}>

          {/* Archive view */}
          {view === "archive" && (
            selectedSession ? (
              <>
                <div style={{
                  padding: "18px 28px 16px",
                  borderBottom: "1px solid var(--border)", flexShrink: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                      color: selectedSession.session_status === "ACHIEVEMENT" ? "#a8f7b8" : "var(--text-faint)",
                    }}>
                      {selectedSession.session_status === "ACHIEVEMENT" ? "✦ RESEARCH RESOLVED" : "RESEARCH · ONGOING"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                      {format(parseISO(selectedSession.started_at), "EEEE, MMMM d · h:mm a")}
                      {selectedSession.ended_at && (
                        <> — {format(parseISO(selectedSession.ended_at), "h:mm a")}</>
                      )}
                    </span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "var(--text)", lineHeight: 1.4, maxWidth: 600 }}>
                    {selectedSession.topic}
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                    {ALL_AGENTS.map((id) => (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <Dot color={ACCENT[id]} size={6} />
                        <span style={{ fontSize: 11, color: ACCENT[id], fontWeight: 500, textTransform: "capitalize" }}>
                          {id}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
                          · {AGENT_ROLES[id]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{
                  flex: 1, overflowY: "auto", padding: "24px 28px",
                  display: "flex", flexDirection: "column", gap: 26,
                }}>
                  {selectedSession.messages.map((msg, i) => (
                    <MessageRow
                      key={i} msg={msg} content={msg.content}
                      humanInputBefore={followedHumanInput(selectedSession.messages, i)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div style={{
                flex: 1, display: "flex", alignItems: "center",
                justifyContent: "center", color: "var(--text-faint)", fontSize: 13,
              }}>
                Select a session
              </div>
            )
          )}

          {/* Live view */}
          {view === "live" && (
            liveSession ? (
              <>
                <div style={{
                  padding: "18px 32px 16px",
                  borderBottom: "1px solid var(--border)", flexShrink: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Dot color="#4ade80" size={7} glow />
                    <span style={{
                      fontSize: 10, color: "#4ade80", fontWeight: 700,
                      letterSpacing: "0.1em", textTransform: "uppercase",
                    }}>
                      Live Research
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 4 }}>
                      {format(parseISO(liveSession.startedAt), "h:mm a")}
                    </span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "var(--text)", lineHeight: 1.4, maxWidth: 600, marginBottom: 14 }}>
                    {liveSession.topic}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      flex: 1, height: 2, background: "var(--border)",
                      borderRadius: 1, maxWidth: 280, overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", width: `${liveProgress * 100}%`,
                        background: "var(--text-dim)", borderRadius: 1,
                        transition: "width 1s linear",
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                      {formatDuration(liveRemaining)} remaining
                    </span>
                  </div>
                </div>

                <div style={{
                  flex: 1, overflowY: "auto", padding: "24px 32px",
                  display: "flex", flexDirection: "column", gap: 26,
                }}>
                  {liveMessages.map((msg, i) => (
                    <MessageRow
                      key={i} msg={msg}
                      content={resolveContent(msg, i)}
                      isAnimating={i === animatingIdx}
                      humanInputBefore={followedHumanInput(liveMessages, i)}
                    />
                  ))}
                  <div ref={liveBottomRef} />
                </div>
              </>
            ) : (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 10,
              }}>
                <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No session running</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  One research session runs daily.{" "}
                  <button onClick={triggerSession} style={{
                    background: "none", border: "none", color: "var(--text-dim)",
                    fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0,
                  }}>
                    Run one now.
                  </button>
                </div>
              </div>
            )
          )}

          {/* About panel — slides over main content area */}
          {showAbout && <AboutPanel onClose={() => setShowAbout(false)} />}
        </main>

        {/* ── Human Inbox (280px, always visible) ─────────────────────────── */}
        <aside style={{
          width: 280, display: "flex", flexDirection: "column",
          borderLeft: "1px solid var(--border)", flexShrink: 0,
          background: "var(--bg)",
        }}>
          {/* Header */}
          <div style={{
            padding: "20px 16px 14px",
            borderBottom: "1px solid var(--border)", flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                Human Inbox
              </span>
              {pendingInbox.length > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  background: "#f7c77e", color: "#0a0a0a",
                  borderRadius: 10, padding: "2px 7px", lineHeight: 1.4,
                }}>
                  {pendingInbox.length}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>
              Agents leave requests here when they need outside information
            </div>
            <div style={{
              fontSize: 10, color: "var(--text-faint)", marginTop: 8,
              padding: "7px 9px", background: "#1a1208",
              border: "1px solid #2a2010", borderRadius: 4, lineHeight: 1.5,
            }}>
              ⚠ Only submit verified, factual information. This platform is public. Do not submit
              opinions, speculation, or unverified claims. Agents will incorporate whatever you
              write into live research.
            </div>
            {injecting && (
              <div style={{ fontSize: 11, color: "#4ade80", marginTop: 6, fontWeight: 500 }}>
                ⚡ Injecting into session…
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>

            {pendingInbox.length === 0 && resolvedInbox.length === 0 && (
              <div style={{ padding: "20px 16px", fontSize: 12, color: "var(--text-faint)" }}>
                No requests yet. Agents will ask here when they need information you can provide.
              </div>
            )}

            {/* Pending requests */}
            {pendingInbox.length > 0 && (
              <div style={{ padding: "10px 0 4px" }}>
                <div style={{
                  padding: "0 16px 6px",
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  color: "var(--text-faint)", textTransform: "uppercase",
                }}>
                  Awaiting Response
                </div>
                {pendingInbox.map((msg) => (
                  <div key={msg.id} style={{
                    margin: "0 10px 8px", padding: "12px 12px",
                    background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <Dot color={ACCENT[msg.agent_id] ?? "#555"} size={6} />
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: ACCENT[msg.agent_id] ?? "var(--text)", textTransform: "capitalize",
                      }}>
                        {msg.agent_name}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
                        · {AGENT_ROLES[msg.agent_id]}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6 }}>
                      {format(parseISO(msg.created_at), "MMM d · h:mm a")}
                    </div>
                    {msg.request_type && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                        color: BADGE_COLORS[msg.request_type] ?? "var(--text-faint)",
                        textTransform: "uppercase",
                        border: `1px solid ${BADGE_COLORS[msg.request_type] ?? "var(--border)"}`,
                        borderRadius: 3, padding: "1px 5px",
                        marginBottom: 6, display: "inline-block",
                      }}>
                        {msg.request_type.replace("_", " ")}
                      </span>
                    )}
                    <div style={{
                      fontSize: 13, color: "var(--text)", lineHeight: 1.55,
                      marginBottom: 10, marginTop: msg.request_type ? 6 : 0,
                    }}>
                      {msg.request}
                    </div>
                    <textarea
                      rows={2}
                      value={draftResponses[msg.id] ?? ""}
                      onChange={(e) =>
                        setDraftResponses((prev) => ({ ...prev, [msg.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitResponse(msg.id);
                        }
                      }}
                      placeholder="Your response… (Enter to send)"
                      style={{
                        width: "100%", background: "var(--surface2, #1a1a1e)",
                        border: "1px solid var(--border-mid)", borderRadius: 4,
                        color: "var(--text)", fontSize: 12, lineHeight: 1.5,
                        padding: "7px 9px", resize: "none", outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                    <button
                      onClick={() => submitResponse(msg.id)}
                      disabled={submitting === msg.id || !draftResponses[msg.id]?.trim()}
                      style={{
                        marginTop: 6, width: "100%", padding: "6px 0",
                        background: "transparent", border: "1px solid var(--border-mid)",
                        borderRadius: 4,
                        color: draftResponses[msg.id]?.trim() ? "var(--text-dim)" : "var(--text-faint)",
                        fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
                        cursor: draftResponses[msg.id]?.trim() ? "pointer" : "not-allowed",
                      }}
                    >
                      {submitting === msg.id ? "Sending…" : "Send Response"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Resolved requests */}
            {resolvedInbox.length > 0 && (
              <div style={{ padding: "6px 0 4px" }}>
                <div style={{
                  padding: "0 16px 6px",
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  color: "var(--text-faint)", textTransform: "uppercase",
                }}>
                  Answered
                </div>
                {resolvedInbox.map((msg) => (
                  <div key={msg.id} style={{
                    margin: "0 10px 6px", padding: "10px 12px",
                    background: "transparent", border: "1px solid var(--border)",
                    borderRadius: 6, opacity: 0.65,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <Dot color={ACCENT[msg.agent_id] ?? "#555"} size={5} />
                      <span style={{ fontSize: 11, color: ACCENT[msg.agent_id] ?? "var(--text)", fontWeight: 600, textTransform: "capitalize" }}>
                        {msg.agent_name}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
                        {format(parseISO(msg.created_at), "MMM d")}
                      </span>
                    </div>
                    {msg.request_type && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                        color: BADGE_COLORS[msg.request_type] ?? "var(--text-faint)",
                        textTransform: "uppercase",
                        border: `1px solid ${BADGE_COLORS[msg.request_type] ?? "var(--border)"}`,
                        borderRadius: 3, padding: "1px 5px",
                        marginBottom: 5, display: "inline-block",
                      }}>
                        {msg.request_type.replace("_", " ")}
                      </span>
                    )}
                    <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 6, marginTop: msg.request_type ? 5 : 0 }}>
                      {msg.request}
                    </div>
                    <div style={{
                      fontSize: 11, color: "var(--text-faint)",
                      borderTop: "1px solid var(--border)", paddingTop: 6, lineHeight: 1.5,
                    }}>
                      → {msg.response}
                    </div>
                    {/* Agent reaction */}
                    <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                        color: ACCENT[msg.agent_id] ?? "var(--text-faint)",
                        textTransform: "uppercase", marginBottom: 4,
                      }}>
                        Agent Reaction
                      </div>
                      {msg.reaction ? (
                        <div style={{
                          fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5,
                          display: "-webkit-box", WebkitLineClamp: 4,
                          WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>
                          {msg.reaction}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-faint)", fontStyle: "italic" }}>
                          Awaiting agent response…
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ height: 16 }} />
          </div>
        </aside>

      </div>

      {/* Main app — mobile (<768px) */}
      <div className="mobile-layout" style={{
        flexDirection: "column", height: "100vh", overflow: "hidden",
        opacity: appVisible ? 1 : 0,
        transition: "opacity 0.6s ease",
        position: "relative",
      }}>

        {/* Mobile top header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text)" }}>AGORA</div>
            <div style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: "0.04em" }}>AI RESEARCH UNIVERSITY</div>
          </div>
          {liveSession && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Dot color="#4ade80" size={7} glow />
              <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 700, letterSpacing: "0.08em" }}>LIVE</span>
            </div>
          )}
        </div>

        {/* Mobile content */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* ── ARCHIVE: session list ── */}
          {mobileTab === "archive" && !mobileSessionOpen && (
            <div style={{ flex: 1, overflowY: "auto" }}>

              {/* Researchers row */}
              <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Researchers</div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {[
                    { id: "quinn", name: "Quinn", role: "Question Framing" },
                    { id: "eva",   name: "Eva",   role: "Evidence Retrieval" },
                    { id: "sol",   name: "Sol",   role: "Hypothesis & Solutions" },
                    { id: "vera",  name: "Vera",  role: "Critic & Verifier" },
                  ].map((a) => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Dot color={ACCENT[a.id]} size={6} />
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{a.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Achievements */}
              {achievements.length > 0 && (
                <div>
                  <div style={{ padding: "12px 16px 4px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#a8f7b8", textTransform: "uppercase" }}>✦ Achievements</span>
                  </div>
                  {achievements.map((s) => (
                    <button key={s.id}
                      onClick={() => { setMobileSessionOpen(true); setSelectedSession(s); setMobileTab("archive"); }}
                      style={{
                        display: "block", width: "100%", padding: "14px 16px", minHeight: 44,
                        background: "transparent", border: "none",
                        borderBottom: "1px solid var(--border)", textAlign: "left", cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: 10, color: "#a8f7b8", fontWeight: 600, marginBottom: 4 }}>
                        ✦ RESOLVED · {format(parseISO(s.date), "MMM d")}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {s.topic}
                      </div>
                    </button>
                  ))}
                  <Divider margin="0" />
                </div>
              )}

              {/* Date chips */}
              {dates.length > 0 && (
                <div style={{ display: "flex", overflowX: "auto", padding: "10px 12px", gap: 6, borderBottom: "1px solid var(--border)" }}>
                  {dates.map((d) => (
                    <button key={d.date}
                      onClick={() => { setView("archive"); selectDate(d.date); }}
                      style={{
                        flexShrink: 0, padding: "8px 14px", minHeight: 36,
                        background: selectedDate === d.date ? "var(--card)" : "transparent",
                        border: `1px solid ${selectedDate === d.date ? "var(--text-faint)" : "var(--border)"}`,
                        borderRadius: 16,
                        color: selectedDate === d.date ? "var(--text)" : "var(--text-dim)",
                        fontSize: 12, cursor: "pointer",
                      }}
                    >
                      {format(parseISO(d.date), "MMM d")} · {d.count}
                    </button>
                  ))}
                </div>
              )}

              {/* Session cards */}
              {sessions.length === 0 ? (
                <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--text-faint)" }}>
                  {dates.length === 0 ? "No sessions yet." : "No sessions on this date."}
                </div>
              ) : sessions.map((s) => {
                const resolved = s.session_status === "ACHIEVEMENT";
                const running  = !s.ended_at;
                return (
                  <button key={s.id}
                    onClick={() => { setMobileSessionOpen(true); setSelectedSession(s); }}
                    style={{
                      display: "block", width: "100%", padding: "14px 16px", minHeight: 44,
                      background: "transparent", border: "none",
                      borderBottom: "1px solid var(--border)", textAlign: "left", cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{format(parseISO(s.started_at), "h:mm a")}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: resolved ? "#a8f7b8" : running ? "#4ade80" : "var(--text-faint)" }}>
                        {resolved ? "✦ RESOLVED" : running ? "● LIVE" : "ONGOING"}
                      </span>
                    </div>
                    {s.session_number > 1 && (
                      <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 3 }}>Session {s.session_number}</div>
                    )}
                    <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.4, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {s.topic}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {ALL_AGENTS.map((id) => <Dot key={id} color={ACCENT[id]} size={5} />)}
                      <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: "auto" }}>{s.messages.length} msgs</span>
                    </div>
                  </button>
                );
              })}

              {/* Run Research */}
              <div style={{ padding: "16px 16px 88px" }}>
                {(() => {
                  const limitReached = runsRemaining !== null && runsRemaining <= 0;
                  const disabled = triggering || limitReached;
                  return (
                    <>
                      <button
                        onClick={triggerSession}
                        disabled={disabled}
                        style={{
                          width: "100%", padding: "14px 0", minHeight: 44,
                          background: "transparent", border: "1px solid var(--border-mid)",
                          borderRadius: 6,
                          color: disabled ? "var(--text-faint)" : "var(--text-dim)",
                          fontSize: 12, fontWeight: 600, letterSpacing: "0.08em",
                          textTransform: "uppercase", cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        {triggering ? "Starting…" : limitReached ? "No Runs Left Today" : "Run Research"}
                      </button>
                      <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6, textAlign: "center" }}>
                        {runsRemaining === null ? "" : limitReached ? "Resets at midnight" : `${runsRemaining} of 5 runs remaining today`}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── ARCHIVE: session detail ── */}
          {mobileTab === "archive" && mobileSessionOpen && selectedSession && (
            <>
              <div style={{
                padding: "0 16px", borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", gap: 10, flexShrink: 0, minHeight: 56,
              }}>
                <button
                  onClick={() => setMobileSessionOpen(false)}
                  style={{
                    background: "none", border: "none", color: "var(--text-dim)",
                    fontSize: 20, cursor: "pointer", padding: "0 8px 0 0",
                    minHeight: 44, minWidth: 44, display: "flex", alignItems: "center",
                  }}
                >
                  ←
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 2 }}>
                    {format(parseISO(selectedSession.started_at), "MMM d · h:mm a")}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {selectedSession.topic}
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 88px", display: "flex", flexDirection: "column", gap: 22 }}>
                {selectedSession.messages.map((msg, i) => (
                  <MessageRow key={i} msg={msg} content={msg.content}
                    humanInputBefore={followedHumanInput(selectedSession.messages, i)} />
                ))}
              </div>
            </>
          )}

          {/* ── LIVE tab ── */}
          {mobileTab === "live" && (
            liveSession ? (
              <>
                <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Dot color="#4ade80" size={7} glow />
                    <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 700, letterSpacing: "0.1em" }}>LIVE RESEARCH</span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 4 }}>{format(parseISO(liveSession.startedAt), "h:mm a")}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", lineHeight: 1.4, marginBottom: 12 }}>
                    {liveSession.topic}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${liveProgress * 100}%`, background: "var(--text-dim)", borderRadius: 1, transition: "width 1s linear" }} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{formatDuration(liveRemaining)} remaining</span>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 88px", display: "flex", flexDirection: "column", gap: 22 }}>
                  {liveMessages.map((msg, i) => (
                    <MessageRow key={i} msg={msg} content={resolveContent(msg, i)}
                      isAnimating={i === animatingIdx}
                      humanInputBefore={followedHumanInput(liveMessages, i)} />
                  ))}
                  <div ref={liveBottomRef} />
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "0 24px" }}>
                <div style={{ fontSize: 14, color: "var(--text-dim)" }}>No session running</div>
                <div style={{ fontSize: 13, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.6 }}>
                  One research session runs daily.{" "}
                  <button onClick={triggerSession} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 13, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
                    Run one now.
                  </button>
                </div>
              </div>
            )
          )}

          {/* ── INBOX tab ── */}
          {mobileTab === "inbox" && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Human Inbox</span>
                  {pendingInbox.length > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#f7c77e", color: "#0a0a0a", borderRadius: 10, padding: "2px 7px" }}>
                      {pendingInbox.length}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>
                  Agents leave requests here when they need outside information
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, padding: "8px 10px", background: "#1a1208", border: "1px solid #2a2010", borderRadius: 4, lineHeight: 1.5 }}>
                  ⚠ Only submit verified, factual information. Agents will incorporate whatever you write into live research.
                </div>
                {injecting && (
                  <div style={{ fontSize: 11, color: "#4ade80", marginTop: 6, fontWeight: 500 }}>⚡ Injecting into session…</div>
                )}
              </div>

              {pendingInbox.length === 0 && resolvedInbox.length === 0 && (
                <div style={{ padding: "24px 16px", fontSize: 13, color: "var(--text-faint)" }}>
                  No requests yet. Agents will ask here when they need information you can provide.
                </div>
              )}

              {pendingInbox.length > 0 && (
                <div style={{ padding: "10px 0" }}>
                  <div style={{ padding: "0 16px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-faint)", textTransform: "uppercase" }}>
                    Awaiting Response
                  </div>
                  {pendingInbox.map((msg) => (
                    <div key={msg.id} style={{ margin: "0 12px 10px", padding: "14px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <Dot color={ACCENT[msg.agent_id] ?? "#555"} size={6} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT[msg.agent_id] ?? "var(--text)", textTransform: "capitalize" }}>{msg.agent_name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>· {AGENT_ROLES[msg.agent_id]}</span>
                      </div>
                      {msg.request_type && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: BADGE_COLORS[msg.request_type] ?? "var(--text-faint)", textTransform: "uppercase", border: `1px solid ${BADGE_COLORS[msg.request_type] ?? "var(--border)"}`, borderRadius: 3, padding: "1px 5px", marginBottom: 8, display: "inline-block" }}>
                          {msg.request_type.replace("_", " ")}
                        </span>
                      )}
                      <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, marginBottom: 12, marginTop: msg.request_type ? 8 : 0 }}>
                        {msg.request}
                      </div>
                      <textarea
                        rows={3}
                        value={draftResponses[msg.id] ?? ""}
                        onChange={(e) => setDraftResponses((prev) => ({ ...prev, [msg.id]: e.target.value }))}
                        placeholder="Your response…"
                        style={{ width: "100%", background: "var(--surface2, #1a1a1e)", border: "1px solid var(--border-mid)", borderRadius: 4, color: "var(--text)", fontSize: 14, lineHeight: 1.5, padding: "10px 12px", resize: "none", outline: "none", fontFamily: "inherit", minHeight: 80, boxSizing: "border-box" }}
                      />
                      <button
                        onClick={() => submitResponse(msg.id)}
                        disabled={submitting === msg.id || !draftResponses[msg.id]?.trim()}
                        style={{ marginTop: 8, width: "100%", padding: "12px 0", minHeight: 44, background: "transparent", border: "1px solid var(--border-mid)", borderRadius: 4, color: draftResponses[msg.id]?.trim() ? "var(--text-dim)" : "var(--text-faint)", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", cursor: draftResponses[msg.id]?.trim() ? "pointer" : "not-allowed" }}
                      >
                        {submitting === msg.id ? "Sending…" : "Send Response"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {resolvedInbox.length > 0 && (
                <div style={{ padding: "6px 0" }}>
                  <div style={{ padding: "0 16px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-faint)", textTransform: "uppercase" }}>Answered</div>
                  {resolvedInbox.map((msg) => (
                    <div key={msg.id} style={{ margin: "0 12px 8px", padding: "12px 14px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, opacity: 0.65 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <Dot color={ACCENT[msg.agent_id] ?? "#555"} size={5} />
                        <span style={{ fontSize: 12, color: ACCENT[msg.agent_id] ?? "var(--text)", fontWeight: 600, textTransform: "capitalize" }}>{msg.agent_name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{format(parseISO(msg.created_at), "MMM d")}</span>
                      </div>
                      {msg.request_type && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: BADGE_COLORS[msg.request_type] ?? "var(--text-faint)", textTransform: "uppercase", border: `1px solid ${BADGE_COLORS[msg.request_type] ?? "var(--border)"}`, borderRadius: 3, padding: "1px 5px", marginBottom: 6, display: "inline-block" }}>
                          {msg.request_type.replace("_", " ")}
                        </span>
                      )}
                      <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 6, marginTop: msg.request_type ? 6 : 0 }}>{msg.request}</div>
                      <div style={{ fontSize: 12, color: "var(--text-faint)", borderTop: "1px solid var(--border)", paddingTop: 6 }}>→ {msg.response}</div>
                      {msg.reaction && (
                        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: ACCENT[msg.agent_id] ?? "var(--text-faint)", textTransform: "uppercase", marginBottom: 4 }}>Agent Reaction</div>
                          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>{msg.reaction}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ height: 80 }} />
            </div>
          )}

        </div>

        {/* Bottom navigation bar */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          height: 60, background: "var(--bg)",
          borderTop: "1px solid var(--border)",
          display: "flex", zIndex: 50,
        }}>
          {([
            { tab: "archive" as const, label: "Archive" },
            { tab: "live"    as const, label: "Live"    },
            { tab: "inbox"   as const, label: "Inbox"   },
          ]).map(({ tab, label }) => (
            <button
              key={tab}
              className="mobile-nav-btn"
              onClick={() => { setMobileTab(tab); if (tab !== "archive") setMobileSessionOpen(false); }}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                background: "none", border: "none", cursor: "pointer",
                color: mobileTab === tab ? "var(--text)" : "var(--text-faint)",
                gap: 3, minHeight: 60,
              }}
            >
              {/* Icon */}
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 }}>
                {tab === "archive" && <span style={{ fontSize: 16 }}>⊟</span>}
                {tab === "live" && (
                  <>
                    <span style={{ fontSize: 16 }}>◉</span>
                    {liveSession && (
                      <span style={{
                        position: "absolute", top: 0, right: 0,
                        width: 7, height: 7, borderRadius: "50%",
                        background: "#4ade80", boxShadow: "0 0 5px #4ade80",
                      }} />
                    )}
                  </>
                )}
                {tab === "inbox" && (
                  <>
                    <span style={{ fontSize: 16 }}>⊡</span>
                    {pendingInbox.length > 0 && (
                      <span style={{
                        position: "absolute", top: -2, right: -4,
                        fontSize: 8, fontWeight: 700,
                        background: "#f7c77e", color: "#0a0a0a",
                        borderRadius: 8, padding: "1px 4px", lineHeight: 1.4,
                      }}>
                        {pendingInbox.length}
                      </span>
                    )}
                  </>
                )}
              </div>
              <span style={{ fontSize: 10, letterSpacing: "0.04em" }}>{label}</span>
            </button>
          ))}
        </div>

      </div>
    </>
  );
}

// ── MessageRow ─────────────────────────────────────────────────────────────

function MessageRow({
  msg,
  content,
  isAnimating = false,
  humanInputBefore = false,
}: {
  msg: Message;
  content: string;
  isAnimating?: boolean;
  humanInputBefore?: boolean;
}) {
  const role = msg.agentRole ?? AGENT_ROLES[msg.agentId] ?? "";
  const isResolved = content.includes("RESEARCH_RESOLVED:");

  return (
    <div style={{
      display: "flex", gap: 12,
      ...(isResolved ? {
        background: "#0d1a0d",
        border: "1px solid #1a3a1a",
        borderRadius: 6,
        padding: "12px 14px",
        margin: "0 -4px",
      } : {}),
    }}>
      <div style={{ paddingTop: 3, flexShrink: 0 }}>
        <Dot color={ACCENT[msg.agentId] ?? "#555"} size={7} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: ACCENT[msg.agentId] ?? "var(--text)",
            textTransform: "capitalize",
          }}>
            {msg.agentName}
          </span>
          {role && (
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
              {role}
            </span>
          )}
          <span style={{ fontSize: 10, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums", marginLeft: "auto" }}>
            {formatDuration(msg.elapsedSeconds)}
          </span>
        </div>
        {humanInputBefore && (
          <div style={{
            fontSize: 10, color: "var(--text-faint)", marginBottom: 4,
            letterSpacing: "0.04em",
          }}>
            ↩ human input
          </div>
        )}
        <div style={{
          fontSize: 13, color: "var(--text)", lineHeight: 1.7,
          minHeight: "1.7em", whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {content}
          {isAnimating && (
            <span style={{
              display: "inline-block", width: 2, height: "0.85em",
              background: "var(--text-faint)", marginLeft: 3,
              verticalAlign: "text-bottom", opacity: 0.7,
            }} />
          )}
        </div>
      </div>
    </div>
  );
}
