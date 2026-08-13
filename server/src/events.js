/*
 * Server-sent events. The server pings on every write; clients refetch.
 *
 * The wall display holds one of these open for weeks at a time, so the
 * bookkeeping here has to be exact: every client that goes away must leave the
 * set, or the process slowly fills with dead response objects and every
 * broadcast gets more expensive.
 */
const clients = new Set();

export function sseHandler(req, res, { board = false } = {}) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");

  const entry = { res, board, since: Date.now() };
  clients.add(entry);

  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, 25000);

  /*
   * Idempotent, and wired to every way a connection can end. 'close' alone is
   * not enough: a TV that drops off the wifi tends to surface as an error or a
   * half-open socket rather than a clean close, and each one of those used to
   * leak an entry plus its 25s timer.
   */
  let done = false;
  function cleanup() {
    if (done) return;
    done = true;
    clearInterval(ping);
    clients.delete(entry);
    try { res.end(); } catch { /* already gone */ }
  }

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("error", cleanup);
  res.on("close", cleanup);
}

/** Tell every connected client something changed; they refetch. */
export function broadcast(topic, payload = {}) {
  const data = JSON.stringify({ topic, ...payload, at: Date.now() });
  for (const entry of [...clients]) {
    try {
      entry.res.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(entry);
    }
  }
}

/** For the health page: how many are listening, and how many are wall displays. */
export function clientCount() {
  return clients.size;
}
export function boardClientCount() {
  let n = 0;
  for (const c of clients) if (c.board) n++;
  return n;
}
