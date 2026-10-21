import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, Check, ChevronDown, Columns3, Play, Search, Table2, Upload, X } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { DOT, tagFor } from '../lib/tags.js';
import { formatAgo, formatNumber, formatTime, plural } from '../lib/format.js';
import { Dialog, useAction, useToast } from '../components/feedback.jsx';
import { Button, Dot, EmptyState, ErrorState, Mono, Segmented, Skeleton, Tag, Textarea, UnderlineTabs } from '../components/ui.jsx';
import { CompanyMark, agentMono, agentName, isTyping, thresholds, useAgents, useFreshIds } from './sales-shared.jsx';
import './accounts.css';

const STAGES = ['found', 'researched', 'qualified', 'in_outreach', 'engaged', 'meeting', 'disqualified'];
const PAGE = 100;
const SORTS = { activity: 'last activity', score: 'score', name: 'name' };

const ICP_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '90', label: '≥ 90%' },
  { value: '80', label: '≥ 80%' },
  { value: '70', label: '≥ 70%' },
  { value: '50', label: '≥ 50%' },
];

const SIZE_BUCKETS = [
  { value: '1-199', label: 'Under 200', min: 1, max: 199 },
  { value: '200-499', label: '200–499', min: 200, max: 499 },
  { value: '500-999', label: '500–999', min: 500, max: 999 },
  { value: '1000-4999', label: '1,000–4,999', min: 1000, max: 4999 },
  { value: '5000-', label: '5,000+', min: 5000, max: Infinity },
];

const NO_FILTERS = { industry: '', size: '', location: '', icp: '', foundBy: '' };

// Survives a trip to an account and back.
const remembered = { view: 'table', stage: 'all', q: '', sort: 'activity', filters: NO_FILTERS };

function region(location) {
  const parts = String(location ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function sizeRange(value, settings) {
  if (value === 'icp') {
    return { min: Number(settings?.employeesMin) || 0, max: Number(settings?.employeesMax) || Infinity };
  }
  return SIZE_BUCKETS.find((b) => b.value === value) ?? null;
}

export default function Accounts() {
  const app = useApp();
  const now = useNow(30_000);
  const { byId, config } = useAgents();
  const [view, setView] = useState(remembered.view);
  const [stage, setStage] = useState(remembered.stage);
  const [q, setQ] = useState(remembered.q);
  const [query, setQuery] = useState(remembered.q);
  const [sort, setSort] = useState(remembered.sort);
  const [filters, setFilters] = useState(remembered.filters);
  const [limit, setLimit] = useState(PAGE);
  const [importing, setImporting] = useState(false);
  const searchRef = useRef(null);

  Object.assign(remembered, { view, stage, q, sort, filters });

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => setLimit(PAGE), [stage, query, sort, view]);

  // "/" jumps to search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || isTyping(e.target) || e.metaKey || e.ctrlKey || document.querySelector('.dialog-root')) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const board = view === 'board';
  const path = `/api/accounts${qs({ stage: board || stage === 'all' ? '' : stage, q: query, sort, limit: board ? 500 : limit })}`;
  const res = useResource(path, ['accounts', 'contacts']);
  const data = res.data;
  const loaded = data?.accounts ?? [];
  const settings = app.workspace?.settings;
  const scout = byId.scout;
  const { outreach } = thresholds(config('qualifier'));

  const options = useMemo(() => {
    const distinct = (pick) => {
      const map = new Map();
      for (const a of loaded) {
        const v = pick(a);
        if (v) map.set(v, (map.get(v) ?? 0) + 1);
      }
      return [...map.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([value, count]) => ({ value, label: value, count }));
    };
    const icpRange = settings?.employeesMin || settings?.employeesMax;
    return {
      industry: [{ value: '', label: 'Any' }, ...distinct((a) => a.industry)],
      location: [{ value: '', label: 'Anywhere' }, ...distinct((a) => region(a.location))],
      size: [
        { value: '', label: 'Any' },
        ...(icpRange
          ? [{ value: 'icp', label: `Your ICP (${formatNumber(settings.employeesMin || 0)}–${settings.employeesMax ? formatNumber(settings.employeesMax) : 'any'})` }]
          : []),
        ...SIZE_BUCKETS.map((b) => ({ value: b.value, label: b.label })),
      ],
      foundBy: [
        { value: '', label: 'Any agent' },
        ...distinct((a) => a.foundBy).map((o) => ({ ...o, label: o.value === 'import' ? 'CSV import' : agentName(byId, o.value) })),
      ],
    };
  }, [loaded, byId, settings]);

  const rows = useMemo(() => {
    const range = filters.size ? sizeRange(filters.size, settings) : null;
    const minIcp = Number(filters.icp) || 0;
    return loaded.filter(
      (a) =>
        (!filters.industry || a.industry === filters.industry) &&
        (!filters.location || region(a.location) === filters.location) &&
        (!range || (a.employees != null && a.employees >= range.min && a.employees <= range.max)) &&
        (!minIcp || (a.icpMatch ?? 0) >= minIcp) &&
        (!filters.foundBy || a.foundBy === filters.foundBy),
    );
  }, [loaded, filters, settings]);

  const activeFilters = Object.values(filters).filter(Boolean).length;
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const clearAll = () => {
    setFilters(NO_FILTERS);
    setQ('');
    setQuery('');
  };

  const [runScout, scoutBusy] = useAction(() => api.post('/api/agents/scout/run'), {
    success: 'Scout started. New accounts show up here as it finds them.',
  });

  const counts = data?.counts ?? {};
  const total = data?.total ?? 0;
  // The header counts every company, not just the ones matching the search.
  const everyone = useRef(null);
  if (data && !query) everyone.current = counts.all ?? total;
  const nothingAtAll = data && (counts.all ?? total) === 0 && !query;
  const filterLabel = (key, opts) => (filters[key] ? opts.find((o) => o.value === filters[key])?.label ?? filters[key] : null);

  return (
    <div className="page acc-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>Accounts</h1>
          <div className="page-sub">
            {!data ? ' ' : nothingAtAll ? ' ' : `${plural(everyone.current ?? counts.all ?? total, 'company', 'companies')} · ${formatNumber(data.foundToday ?? 0)} found today`}
          </div>
        </div>
        <Button variant="outline" icon={Upload} onClick={() => setImporting(true)}>
          Import CSV
        </Button>
        <Button icon={Play} onClick={() => runScout()} loading={scoutBusy} disabled={scout?.running}>
          {scout?.running ? 'Scout is running' : 'Run Scout now'}
        </Button>
      </header>

      <div className="acc-toolbar">
        <label className="acc-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQ('');
                e.currentTarget.blur();
              }
            }}
            placeholder="Search companies or domains"
            aria-label="Search companies or domains"
          />
          {q ? (
            <button type="button" className="acc-search-clear" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={12} />
            </button>
          ) : (
            <kbd className="kbd">/</kbd>
          )}
        </label>
        <FilterChip label="Industry" value={filters.industry} options={options.industry} onChange={(v) => setFilter('industry', v)} current={filterLabel('industry', options.industry)} />
        <FilterChip label="Employees" value={filters.size} options={options.size} onChange={(v) => setFilter('size', v)} current={filterLabel('size', options.size)} />
        <FilterChip label="Location" value={filters.location} options={options.location} onChange={(v) => setFilter('location', v)} current={filterLabel('location', options.location)} />
        <FilterChip label="ICP match" value={filters.icp} options={ICP_OPTIONS} onChange={(v) => setFilter('icp', v)} current={filterLabel('icp', ICP_OPTIONS)} />
        <FilterChip label="Found by" value={filters.foundBy} options={options.foundBy} onChange={(v) => setFilter('foundBy', v)} current={filterLabel('foundBy', options.foundBy)} />
        <div className="acc-view">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'table', label: 'Table', icon: Table2 },
              { value: 'board', label: 'Board', icon: Columns3 },
            ]}
          />
        </div>
      </div>

      {!board && (
        <UnderlineTabs
          value={stage}
          onChange={setStage}
          options={[
            { value: 'all', label: 'All', count: data ? counts.all ?? 0 : null },
            ...STAGES.map((s) => ({ value: s, label: tagFor('stage', s).label, count: data ? counts[s] ?? 0 : null })),
          ]}
        />
      )}

      {res.error && !data ? (
        <ErrorState error={res.error} onRetry={res.refresh} />
      ) : nothingAtAll ? (
        <EmptyState
          icon={Building2}
          title="No accounts yet"
          actions={
            <>
              <Button icon={Play} onClick={() => runScout()} loading={scoutBusy}>
                Run Scout now
              </Button>
              <Button variant="outline" onClick={() => (window.location.hash = '#/settings')}>
                Edit ICP
              </Button>
            </>
          }
        >
          {scout?.nextRunAt ? `Scout runs next at ${formatTime(scout.nextRunAt)}.` : null}
        </EmptyState>
      ) : board ? (
        <Board rows={rows} counts={counts} loading={!data} outreachAt={outreach} filtered={activeFilters > 0 || !!query} onOpenStage={(s) => {
          setStage(s);
          setView('table');
        }} />
      ) : (
        <AccountTable
          rows={rows}
          loading={!data}
          now={now}
          byId={byId}
          outreachAt={outreach}
          sort={sort}
          onSort={setSort}
          footer={
            data && (
              <div className="acc-foot">
                <span>
                  Showing {formatNumber(rows.length)} of {formatNumber(total)}
                  {activeFilters > 0 && loaded.length < total ? ` · filters apply to the first ${formatNumber(loaded.length)}` : ''}
                  {activeFilters > 0 && (
                    <>
                      {' · '}
                      <button type="button" className="acc-clear" onClick={() => setFilters(NO_FILTERS)}>
                        Clear {activeFilters === 1 ? 'filter' : 'filters'}
                      </button>
                    </>
                  )}
                </span>
                {loaded.length < total && (
                  <button type="button" className="acc-more" onClick={() => setLimit((l) => l + PAGE)}>
                    Load {formatNumber(Math.min(PAGE, total - loaded.length))} more
                  </button>
                )}
                <span>Sorted by {SORTS[sort]}</span>
              </div>
            )
          }
          empty={
            <EmptyState
              compact={false}
              title={activeFilters || query ? 'No accounts match' : `No ${tagFor('stage', stage).label.toLowerCase()} accounts`}
              actions={
                activeFilters || query ? (
                  <Button variant="outline" onClick={clearAll}>
                    Clear search and filters
                  </Button>
                ) : null
              }
            >
              {activeFilters || query ? 'Try a broader search or remove a filter.' : 'Accounts move through the stages as agents work on them.'}
            </EmptyState>
          }
        />
      )}

      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

// ── Filter chip with a small menu ──────────────────────────────

function FilterChip({ label, value, options, onChange, current, anyLabel = 'Any' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) ref.current?.querySelector('[aria-selected="true"]')?.focus();
  }, [open]);

  return (
    <div className="acc-filter" ref={ref}>
      <button type="button" className={value ? 'acc-chip active' : 'acc-chip'} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="acc-chip-key">{label}</span>
        <span className="acc-chip-value">{current ?? anyLabel}</span>
        <ChevronDown size={12} className={open ? 'acc-chev open' : 'acc-chev'} />
      </button>
      {open && (
        <div className="acc-menu" role="listbox" aria-label={label}>
          {options.length <= 1 && <span className="acc-menu-empty">No values yet</span>}
          {options.map((o) => (
            <button
              key={o.value || 'any'}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="acc-menu-item"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="acc-menu-check">{o.value === value && <Check size={14} />}</span>
              <span className="acc-menu-label">{o.label}</span>
              {o.count != null && <span className="acc-menu-count">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Table ──────────────────────────────────────────────────────

function SortHead({ label, by, sort, onSort, className }) {
  const on = sort === by;
  return (
    <button type="button" className={['acc-sort', on && 'on', className].filter(Boolean).join(' ')} onClick={() => onSort(by)} aria-pressed={on}>
      {label}
      {on && (by === 'name' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );
}

function AccountTable({ rows, loading, now, byId, outreachAt, sort, onSort, footer, empty }) {
  const isFresh = useFreshIds(
    rows.map((a) => a.id),
    !loading,
  );
  return (
    <div className="acc-table">
      <div className="acc-grid acc-head">
        <SortHead label="Company" by="name" sort={sort} onSort={onSort} />
        <span>Industry</span>
        <span className="num">Employees</span>
        <span>Location</span>
        <span>ICP match</span>
        <span>Stage</span>
        <SortHead label="Score" by="score" sort={sort} onSort={onSort} className="num-head" />
        <SortHead label="Last activity" by="activity" sort={sort} onSort={onSort} />
      </div>
      {loading ? (
        Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="acc-grid acc-row acc-row-skeleton">
            <span className="acc-company">
              <Skeleton width={24} height={24} radius={6} />
              <Skeleton width={`${50 + ((i * 17) % 40)}%`} height={12} />
            </span>
            <Skeleton width="70%" height={10} />
            <Skeleton width="60%" height={10} />
            <Skeleton width="70%" height={10} />
            <Skeleton width="80%" height={10} />
            <Skeleton width={72} height={16} />
            <Skeleton width="60%" height={10} />
            <Skeleton width="80%" height={10} />
          </div>
        ))
      ) : rows.length === 0 ? (
        empty
      ) : (
        rows.map((a) => <AccountRow key={a.id} account={a} now={now} byId={byId} outreachAt={outreachAt} fresh={isFresh(a.id)} />)
      )}
      {!loading && footer}
    </div>
  );
}

function AccountRow({ account: a, now, byId, outreachAt, fresh }) {
  const act = a.lastActivity;
  const actText = act?.text ?? (a.foundBy ? `${a.foundBy === 'import' ? 'Imported' : `${agentName(byId, a.foundBy)} found`}${a.foundVia ? ` via ${a.foundVia}` : ''}` : '—');
  const actAt = act?.at ?? a.foundAt;
  const actAgent = act ? act.agentId : a.foundBy === 'import' ? null : a.foundBy;
  return (
    <a href={`#/accounts/${a.id}`} className={fresh ? 'acc-grid acc-row row-enter' : 'acc-grid acc-row'}>
      <span className="acc-company">
        <CompanyMark name={a.name} size="sm" />
        <span className="acc-company-text">
          <span className="acc-name">{a.name}</span>
          <span className="acc-domain">{a.domain}</span>
        </span>
      </span>
      <span className="acc-muted">{a.industry ?? '—'}</span>
      <span className="acc-mono num">{a.employees != null ? formatNumber(a.employees) : '—'}</span>
      <span className="acc-muted">{a.location ?? '—'}</span>
      <span className="acc-icp">
        <span className="acc-icp-n">{a.icpMatch != null ? `${a.icpMatch}%` : '—'}</span>
        <span className="acc-icp-bar">
          <span style={{ width: `${a.icpMatch ?? 0}%` }} />
        </span>
      </span>
      <span>
        <Tag kind="stage" value={a.stage} />
      </span>
      <span className={a.score != null && a.score >= outreachAt ? 'acc-score num' : 'acc-score acc-score-low num'}>{a.score ?? '—'}</span>
      <span className="acc-activity">
        {actAgent ? <Mono size="xs">{agentMono(byId, actAgent)}</Mono> : <span className="acc-you">You</span>}
        <span className="acc-activity-text" title={actText}>
          {actText}
        </span>
        <span className="acc-ago">{formatAgo(actAt, now)}</span>
      </span>
    </a>
  );
}

// ── Board ──────────────────────────────────────────────────────

const BOARD_CAP = 30;

function Board({ rows, counts, loading, outreachAt, filtered, onOpenStage }) {
  const byStage = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s, []]));
    for (const a of rows) map[a.stage]?.push(a);
    return map;
  }, [rows]);

  return (
    <div className="acc-board">
      {STAGES.map((s, col) => {
        const t = tagFor('stage', s);
        const cards = byStage[s];
        const n = filtered ? cards.length : counts[s] ?? cards.length;
        return (
          <div key={s} className="acc-col" style={{ animationDelay: `${col * 30}ms` }}>
            <div className="acc-col-head">
              <Dot color={DOT[t.color]} />
              <span>{t.label}</span>
              <span className="acc-col-n">{loading ? '' : formatNumber(n)}</span>
            </div>
            {loading
              ? [0, 1].map((i) => (
                  <div key={i} className="acc-card">
                    <Skeleton width="70%" height={12} />
                    <Skeleton width="50%" height={10} />
                  </div>
                ))
              : cards.slice(0, BOARD_CAP).map((a) => (
                  <a key={a.id} href={`#/accounts/${a.id}`} className="acc-card">
                    <span className="acc-card-name">{a.name}</span>
                    <span className="acc-card-meta">{[a.employees != null ? formatNumber(a.employees) : null, a.location].filter(Boolean).join(' · ') || a.domain}</span>
                    <span className="acc-card-foot">
                      <span>{a.icpMatch != null ? `${a.icpMatch}% match` : 'No match yet'}</span>
                      <span className={a.score != null && a.score >= outreachAt ? 'acc-card-score' : 'acc-card-score low'}>{a.score ?? '—'}</span>
                    </span>
                  </a>
                ))}
            {!loading && cards.length > BOARD_CAP && (
              <button type="button" className="acc-col-more" onClick={() => onOpenStage(s)}>
                View all {formatNumber(n)} →
              </button>
            )}
            {!loading && cards.length === 0 && <span className="acc-col-empty">None</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Import ─────────────────────────────────────────────────────

function ImportDialog({ open, onClose }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setCsv('');
    setFileName('');
    setError(null);
    // Dialog focuses its first button; the paste box is where people start.
    const t = setTimeout(() => textRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  const rowsCount = useMemo(() => Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim()).length - 1), [csv]);

  const pick = async (file) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      setError('That file is over 5 MB. Split it into smaller files.');
      return;
    }
    setFileName(file.name);
    setError(null);
    setCsv(await file.text());
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/accounts/import', { csv });
      const parts = [`Imported ${plural(r.imported, 'account')}.`];
      if (r.skipped) parts.push(`${formatNumber(r.skipped)} skipped as duplicates or missing a name or domain.`);
      if (r.imported) parts.push('Researcher picks them up next.');
      toast(parts.join(' '), { tone: r.imported ? 'success' : 'neutral', duration: 6000 });
      onClose();
    } catch (err) {
      setError(err?.message ?? 'Couldn’t import that file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import accounts from CSV"
      description="Needs a header row with name and domain. Industry, employees and location are optional. Duplicates are skipped."
      width={560}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!csv.trim()}>
            {rowsCount ? `Import ${plural(rowsCount, 'row')}` : 'Import'}
          </Button>
        </>
      }
    >
      <Textarea
        ref={textRef}
        className="acc-import-text mono"
        rows={8}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setFileName('');
        }}
        placeholder={'name,domain,industry,employees,location\nAcme Health,acmehealth.org,Hospital & health system,1200,"Detroit, MI"'}
        aria-label="CSV"
        spellCheck={false}
      />
      <div className="acc-import-file">
        <Button variant="outline" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
          Choose file
        </Button>
        <span className="muted small">{fileName ? `Loaded ${fileName}` : 'Or paste the rows above.'}</span>
        <input ref={fileRef} type="file" accept=".csv,text/csv,.tsv,text/plain" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {error && <div className="form-error">{error}</div>}
    </Dialog>
  );
}
