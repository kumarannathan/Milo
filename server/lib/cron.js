// Minimal five-field cron: minute hour day-of-month month day-of-week.
// Supports *, n, a-b, lists (a,b,c) and steps (*/n, a-b/n).

const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(field, [min, max]) {
  const values = new Set();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let lo;
    let hi;
    if (rangePart === '*') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      [lo, hi] = rangePart.split('-').map(Number);
    } else {
      lo = Number(rangePart);
      hi = stepPart ? max : lo;
    }
    if (![lo, hi, step].every(Number.isInteger) || lo < min || hi > max || lo > hi || step < 1) {
      throw new Error(`Invalid cron field "${field}"`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron needs 5 fields, got ${fields.length}`);
  const [minute, hour, dom, month, dow] = fields.map((f, i) => parseField(f, RANGES[i]));
  return { minute, hour, dom, month, dow, domAny: fields[2] === '*', dowAny: fields[4] === '*' };
}

export function isValidCron(expr) {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

// Next time strictly after `from` that matches the expression (local time).
export function nextCronDate(expr, from = new Date()) {
  const c = parseCron(expr);
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (d.getTime() <= limit) {
    if (!c.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    const domOk = c.dom.has(d.getDate());
    const dowOk = c.dow.has(d.getDay());
    const dayOk = c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

// Plain-English label for the presets the UI offers; falls back to the expression.
export function describeCron(expr) {
  const m = String(expr).trim().match(/^\*\/(\d+) \* \* \* \*$/);
  if (m) return Number(m[1]) === 1 ? 'Every minute' : `Every ${m[1]} minutes`;
  const h = String(expr).trim().match(/^0 \*\/(\d+) \* \* \*$/);
  if (h) return Number(h[1]) === 1 ? 'Every hour' : `Every ${h[1]} hours`;
  if (/^0 \* \* \* \*$/.test(String(expr).trim())) return 'Every hour';
  const daily = String(expr).trim().match(/^(\d+) (\d+) \* \* \*$/);
  if (daily) {
    const d = new Date();
    d.setHours(Number(daily[2]), Number(daily[1]), 0, 0);
    return `Daily at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return expr;
}
