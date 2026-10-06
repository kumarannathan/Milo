import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Building2, CandlestickChart, Moon, Pause, Play, Search, Sun } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useResource } from '../lib/live.js';
import { navigate } from '../lib/router.js';
import { NAV } from './Sidebar.jsx';
import { useToast } from './feedback.jsx';
import { Kbd, Mono } from './ui.jsx';

function useSearch(playbookId, query) {
  const [results, setResults] = useState([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (playbookId === 'sales') {
          const r = await api.get(`/api/accounts${qs({ q, limit: 6 })}`);
          if (!cancelled) setResults(r.accounts.map((a) => ({ id: a.id, label: a.name, hint: a.domain, href: `#/accounts/${a.id}` })));
        } else {
          const r = await api.get(`/api/markets${qs({ q, status: 'all' })}`);
          if (!cancelled) setResults(r.markets.slice(0, 6).map((m) => ({ id: m.id, label: m.question, hint: m.category ?? '', href: `#/markets/${m.id}` })));
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [playbookId, query]);
  return results;
}

export function CommandPalette({ dark, onToggleTheme }) {
  const app = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const agents = useResource(open ? '/api/agents' : null, ['agents']).data?.agents ?? [];
  const found = useSearch(app.playbook.id, open ? query : '');

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('milo:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('milo:palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands = useMemo(() => {
    const ws = app.workspace;
    const go = (href) => () => navigate(href);
    const list = [];
    for (const id of app.playbook.nav) {
      const item = NAV[id];
      if (item) list.push({ id: `go-${id}`, group: 'Go to', label: item.label, icon: item.icon, run: go(`/${id}`) });
    }
    for (const a of agents) {
      list.push({ id: `open-${a.id}`, group: 'Agents', label: `Open ${a.name}`, mono: a.mono, run: go(`/agents/${a.id}`) });
      list.push({
        id: `run-${a.id}`,
        group: 'Agents',
        label: `Run ${a.name} now`,
        mono: a.mono,
        run: async () => {
          try {
            await api.post(`/api/agents/${a.id}/run`);
            toast(`${a.name} started.`, { tone: 'success' });
          } catch (err) {
            toast(err.message, { tone: 'error' });
          }
        },
      });
    }
    list.push({
      id: 'pause',
      group: 'Team',
      label: ws.paused ? 'Resume team' : 'Pause team',
      icon: ws.paused ? Play : Pause,
      run: async () => {
        try {
          await api.post(ws.paused ? '/api/workspace/resume' : '/api/workspace/pause');
          toast(ws.paused ? 'Team resumed.' : 'Team paused.', { tone: 'success' });
        } catch (err) {
          toast(err.message, { tone: 'error' });
        }
      },
    });
    list.push({ id: 'theme', group: 'Team', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? Sun : Moon, run: onToggleTheme });
    if (app.playbook.id === 'sales') list.push({ id: 'import', group: 'Team', label: 'Import accounts from CSV', icon: Building2, run: go('/accounts') });
    else list.push({ id: 'add-market', group: 'Team', label: 'Add a market by link', icon: CandlestickChart, run: go('/markets') });
    return list;
  }, [app.workspace, app.playbook, agents, dark, onToggleTheme, toast]);

  const q = query.trim().toLowerCase();
  const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)) : commands;
  const items = [
    ...found.map((r) => ({ id: `found-${r.id}`, group: app.playbook.id === 'sales' ? 'Accounts' : 'Markets', label: r.label, hint: r.hint, icon: ArrowRight, run: () => navigate(r.href) })),
    ...filtered,
  ];
  const active = Math.min(index, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  function choose(item) {
    setOpen(false);
    item?.run();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    }
  }

  let lastGroup = null;
  return createPortal(
    <div className="palette-root" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} className="muted-icon" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={app.playbook.id === 'sales' ? 'Search accounts or type a command' : 'Search markets or type a command'}
            aria-label="Search"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <div className="palette-empty">No matches</div>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className={i === active ? 'palette-item active' : 'palette-item'}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => choose(item)}
                >
                  {item.mono ? <Mono size="xs">{item.mono}</Mono> : Icon ? <Icon size={14} /> : null}
                  <span className="palette-label truncate">{item.label}</span>
                  {item.hint && <span className="palette-hint truncate">{item.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>⌘K</Kbd> toggle
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
