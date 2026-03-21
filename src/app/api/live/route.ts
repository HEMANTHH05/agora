import { emitter, LiveEvent } from "@/lib/emitter";

export const dynamic = "force-dynamic";

// Server-Sent Events endpoint.
// The browser opens one persistent connection here; we push JSON events
// as agents speak. The connection stays open until the browser closes it.

export async function GET() {
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: LiveEvent) {
        // SSE format: "data: <json>\n\n"
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller already closed — client disconnected
        }
      }

      // Send a heartbeat comment every 25s to keep the connection alive
      // through proxies/load balancers that close idle connections
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      emitter.on("live", send);

      cleanup = () => {
        emitter.off("live", send);
        clearInterval(heartbeat);
      };
    },

    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable Nginx buffering if behind a proxy
    },
  });
}
