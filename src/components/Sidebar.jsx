import { Building2, Inbox, LayoutDashboard, MessageSquare, Plug, Search, UserRound, Users } from 'lucide-react';
import { useApp } from '../lib/app-context.jsx';
import { useLiveStatus, useResource } from '../lib/live.js';
import { Dot, Kbd } from './ui.jsx';
import { UserMenu } from './UserMenu.jsx';

export const NAV = {
  'control-room': { label: 'Control room', icon: LayoutDashboard },
  approvals: { label: 'Approvals', icon: Inbox },
  accounts: { label: 'Accounts', icon: Building2 },
  conversations: { label: 'Conversations', icon: MessageSquare },
  agents: { label: 'Agents', icon: Users },
  connections: { label: 'Connections', icon: Plug },
  account: { label: 'Account', icon: UserRound },
};

// Nav groups, in order. A playbook only shows the ids it lists; Account lives in the user menu.
const SECTIONS = [
  ['Today', ['control-room', 'approvals']],
  ['Pipeline', ['accounts', 'conversations']],
  ['Team', ['agents', 'connections']],
];

export function Sidebar({ active, dark, onToggleTheme }) {
  const { workspace, playbook, runner, connections } = useApp();
  const live = useLiveStatus();
  const approvals = useResource('/api/approvals?status=pending&limit=1', ['approvals']);
  const threads = useResource(playbook?.id === 'sales' ? '/api/threads?status=us' : null, ['threads']);
  const agents = useResource('/api/agents', ['agents']);

  const counts = {
    approvals: approvals.data?.counts?.pending ?? 0,
    conversations: threads.data?.counts?.us ?? 0,
  };
  const alerts = {
    agents: (agents.data?.agents ?? []).some((a) => a.status === 'error'),
    connections: connections.some((c) => c.status === 'expired' || c.status === 'error'),
  };
  const online = live && runner?.online;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <a href="#/control-room" className="sidebar-wordmark">
          Milo
        </a>
      </div>

      <a href="#/account" className="workspace-card" title="Workspace">
        <span className="workspace-mark">{(workspace?.name ?? 'M')[0].toUpperCase()}</span>
        <span className="workspace-text">
          <span className="workspace-name">{workspace?.name}</span>
          <span className="workspace-playbook">{playbook?.name}</span>
        </span>
      </a>

      <button type="button" className="search-trigger" onClick={() => window.dispatchEvent(new Event('milo:palette'))}>
        <Search size={14} />
        <span>Search</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav className="sidebar-nav" aria-label="Main">
        {SECTIONS.map(([label, ids]) => {
          const items = (playbook?.nav ?? []).filter((id) => ids.includes(id) && NAV[id]);
          if (!items.length) return null;
          return (
            <div key={label} className="nav-section">
              <span className="nav-section-label">{label}</span>
              {items.map((id) => {
                const item = NAV[id];
                const Icon = item.icon;
                const n = counts[id] ?? 0;
                return (
                  <a key={id} href={`#/${id}`} className={id === active ? 'nav-item active' : 'nav-item'} aria-current={id === active ? 'page' : undefined}>
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="nav-label">{item.label}</span>
                    {n > 0 && <span className={id === 'approvals' ? 'nav-count' : 'nav-count nav-count-quiet'}>{n > 99 ? '99+' : n}</span>}
                    {!n && alerts[id] && <span className="nav-alert" aria-label="Needs attention" />}
                  </a>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="runner-status">
          <Dot color={online ? (workspace?.paused ? 'var(--warning)' : 'var(--success)') : 'var(--destructive)'} pulse={online && !workspace?.paused} />
          <span>{!online ? 'Offline' : workspace?.paused ? 'Team paused' : 'Team running'}</span>
        </div>
        <UserMenu dark={dark} onToggleTheme={onToggleTheme} />
      </div>
    </aside>
  );
}
