const clients = new Set();

export function sseHandler(req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");

  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
    res.end();
  });
}

/** Tell every connected client something changed; they refetch. */
export function broadcast(topic, payload = {}) {
  const data = JSON.stringify({ topic, ...payload, at: Date.now() });
  for (const res of clients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}
