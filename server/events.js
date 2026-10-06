// Server-sent events: the UI subscribes once and refetches whatever collections changed.

export function createEventBus() {
  const clients = new Set();

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  return {
    subscribe(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },

    publish(topics) {
      const payload = `event: change\ndata: ${JSON.stringify(topics)}\n\n`;
      for (const res of clients) res.write(payload);
    },

    close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
