// Helpers shared by the demo provider's handlers.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic pseudo-random numbers so a demo workspace looks the same run to run.
export function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// MILO_DEMO_FAST=1 shrinks every simulated delay ~200x so tests and scripts run quickly.
export const demoFast = () => process.env.MILO_DEMO_FAST === '1';
export const demoDelay = (ms) => (demoFast() ? ms / 200 : ms);

// Simulate a vendor call: waits a realistic amount of time and records a tool call.
export function fake(io, op, fn, { min = 150, max = 900 } = {}) {
  return io.track(op, async () => {
    await sleep(demoDelay(min + Math.random() * (max - min)));
    return fn();
  });
}

// Rough token counts so the demo shows believable usage numbers.
export const tokens = (text) => Math.max(1, Math.round(String(text ?? '').length / 4));
