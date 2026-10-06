import { newAccount } from '../records.js';
import { icpFromSettings, icpMatch, isHoldError, normalizeDomain, optionalCall, providerName, startOfDay, touchAccount } from '../util.js';

function describeIcp(icp) {
  const parts = [];
  if (icp.industries.length) parts.push(icp.industries.slice(0, 2).join(', ').toLowerCase());
  const k = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k`.replace('.0k', 'k') : String(n));
  if (icp.employeesMin != null || icp.employeesMax != null) parts.push(`${k(icp.employeesMin ?? 1)}–${icp.employeesMax != null ? k(icp.employeesMax) : 'any'}`);
  if (icp.locations.length) parts.push(icp.locations.join(', ').replace(/United States/i, 'US'));
  return parts.join(', ');
}

// Optional lookups never block a find; a missing signal is better than a missing account.
async function signalsFor(ctx, account) {
  const out = [];
  const funding = await optionalCall(ctx, 'signals.funding', { domain: account.domain, name: account.name });
  for (const s of funding?.items ?? []) out.push({ type: s.type || 'Funding', date: s.date ?? null, title: s.title, url: s.url });
  const hiring = await optionalCall(ctx, 'signals.hiring', { domain: account.domain, name: account.name });
  for (const s of hiring?.items ?? []) out.push({ type: s.type || 'Hiring', date: s.date ?? null, title: s.title, url: s.url });
  return out.filter((s) => s.title);
}

export default {
  id: 'scout',
  name: 'Scout',
  mono: 'Sc',
  job: 'Finds companies that match your ICP',
  consumes: ['find_accounts'],
  produces: ['research_account'],
  schedule: { type: 'cron', cron: '0 */4 * * *' },
  demoSchedule: { type: 'cron', cron: '*/15 * * * *' },
  // Manual "find accounts" requests run right away instead of waiting for the next cron.
  wakeOnTasks: true,
  capabilities: [
    { key: 'accounts.search', required: true },
    { key: 'signals.funding', required: false },
    { key: 'signals.hiring', required: false },
    { key: 'crm.read', required: false },
    { key: 'llm.complete', required: false },
  ],
  config: [
    { key: 'batchSize', label: 'Batch size', type: 'number', default: 25, min: 1, max: 200, suffix: 'per run' },
    { key: 'skipCustomers', label: 'Skip customers', type: 'boolean', default: true, help: 'Uses your CRM when one is connected.' },
    { key: 'dailyCap', label: 'Daily cap', type: 'number', default: 200, min: 1, suffix: 'accounts' },
  ],

  async run(ctx) {
    const { store, config } = ctx;
    const icp = icpFromSettings(ctx.settings);
    let requested = null;
    // Manual "find accounts" requests may narrow the ICP or ask for a specific number.
    for (const task of ctx.tasks.filter((t) => t.type === 'find_accounts')) {
      const p = task.payload ?? {};
      if (p.icp) Object.assign(icp, icpFromSettings({ ...ctx.settings, ...p.icp }));
      if (Number(p.limit) > 0) requested = Math.max(requested ?? 0, Number(p.limit));
    }

    const since = startOfDay().getTime();
    const foundToday = store.count('accounts', (a) => a.foundBy === 'scout' && a.foundAt && Date.parse(a.foundAt) >= since);
    const room = Math.max(0, Number(config.dailyCap) - foundToday);
    if (!room) return { summary: `Daily cap of ${config.dailyCap} accounts reached` };
    const limit = Math.min(requested ?? (Number(config.batchSize) || 25), room);

    const provider = providerName(ctx.connection('accounts.search'));
    ctx.progress(`Searching ${provider ?? 'your data provider'}: ${describeIcp(icp) || 'your ICP'}`);

    const existing = new Set(store.list('accounts').map((a) => a.domain).filter(Boolean));
    const result = await ctx.call('accounts.search', { icp, limit, excludeDomains: [...existing] });

    const candidates = [];
    for (const r of result?.accounts ?? []) {
      const domain = normalizeDomain(r?.domain);
      if (!r?.name || !domain || existing.has(domain)) continue;
      existing.add(domain);
      candidates.push({ ...r, domain });
      if (candidates.length >= limit) break;
    }

    let customers = 0;
    const checkCrm = config.skipCustomers && ctx.has('crm.read');
    const found = [];
    for (const c of candidates) {
      if (checkCrm) {
        ctx.progress(`Checking ${c.name} against your CRM`);
        try {
          const crm = await ctx.call('crm.read', { domain: c.domain });
          if (crm?.isCustomer) {
            customers++;
            continue;
          }
        } catch (err) {
          // Better to wait than to cold-email a customer because the CRM was unreachable.
          if (isHoldError(err)) throw err;
        }
      }

      ctx.progress(`Checking signals for ${c.name}`);
      const signals = await signalsFor(ctx, c);
      const account = store.insert(
        'accounts',
        newAccount(c, { foundBy: 'scout', foundVia: provider ?? c.source ?? 'Unknown', signals, icpMatch: icpMatch(c, icp) }),
      );
      touchAccount(store, account.id, 'scout', `Scout found via ${account.foundVia}`);
      ctx.emit('research_account', { accountId: account.id }, { dedupeKey: `research:${account.id}` });

      const size = account.employees ? `${account.employees.toLocaleString('en-US')} employees` : null;
      const city = account.location ? account.location.split(',')[0] : null;
      ctx.activity({
        pre: 'found',
        link: account.name,
        href: `#/accounts/${account.id}`,
        post: [size, city].filter(Boolean).length ? `· ${[size, city].filter(Boolean).join(', ')}` : '',
        tag: 'found',
      });
      found.push(account);
    }

    const skipped = customers ? ` · ${customers} existing customer${customers === 1 ? '' : 's'} skipped` : '';
    if (!found.length) return { summary: `No new accounts matched your ICP${skipped}` };
    return { summary: `${found.length} account${found.length === 1 ? '' : 's'} found${skipped}` };
  },
};
