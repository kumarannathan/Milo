import {
  Building2,
  CandlestickChart,
  Inbox,
  LayoutDashboard,
  LineChart,
  MessageSquare,
  Moon,
  Plug,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { useApp } from '../lib/app-context.jsx';
import { useLiveStatus, useResource } from '../lib/live.js';
import { Avatar, Dot, Kbd } from './ui.jsx';
import { initials } from '../lib/format.js';

export const NAV = {
  'control-room': { label: 'Control room', icon: LayoutDashboard },
  approvals: { label: 'Approvals', icon: Inbox },
  accounts: { label: 'Accounts', icon: Building2 },
  conversations: { label: 'Conversations', icon: MessageSquare },
  markets: { label: 'Markets', icon: CandlestickChart },
  positions: { label: 'Positions', icon: LineChart },
  agents: { label: 'Agents', icon: Users },
  connections: { label: 'Connections', icon: Plug },
  settings: { label: 'Settings', icon: Settings },
};

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
        <span className="sidebar-version">v{__APP_VERSION__}</span>
      </div>

      <a href="#/settings" className="workspace-card" title="Workspace settings">
        <span className="workspace-mark">{(workspace?.name ?? 'M')[0].toUpperCase()}</span>
        <span className="workspace-text">
          <span className="workspace-name">{workspace?.name}</span>
          <span className="workspace-playbook">
            {playbook?.name}
            {workspace?.demo && <span className="tag" title="Running on sample data">Demo</span>}
          </span>
        </span>
      </a>

      <button type="button" className="search-trigger" onClick={() => window.dispatchEvent(new Event('milo:palette'))}>
        <Search size={14} />
        <span>Search</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav className="sidebar-nav" aria-label="Main">
        {(playbook?.nav ?? []).map((id) => {
          const item = NAV[id];
          if (!item) return null;
          const Icon = item.icon;
          const n = counts[id] ?? 0;
          return (
            <a key={id} href={`#/${id}`} className={id === active ? 'nav-item active' : 'nav-item'} aria-current={id === active ? 'page' : undefined}>
              <Icon size={16} />
              <span className="nav-label">{item.label}</span>
              {n > 0 && <span className="nav-count">{n > 99 ? '99+' : n}</span>}
              {!n && alerts[id] && <span className="nav-alert" aria-label="Needs attention" />}
            </a>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="runner-status">
          <Dot color={online ? (workspace?.paused ? 'var(--warning)' : 'var(--success)') : 'var(--destructive)'} pulse={online && !workspace?.paused} />
          <span>
            {!online
              ? 'Runner offline'
              : workspace?.paused
                ? 'Team paused'
                : `Runner online · ${runner.workers} ${runner.workers === 1 ? 'worker' : 'workers'}`}
          </span>
        </div>
        <button type="button" className="nav-item" onClick={onToggleTheme}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
          <span className="nav-label">{dark ? 'Light theme' : 'Dark theme'}</span>
        </button>
        <div className="user-row">
          <Avatar initials={initials(workspace?.owner?.name)} size={28} />
          <span className="user-text">
            <span className="user-name">{workspace?.owner?.name}</span>
            {workspace?.owner?.email && <span className="user-email">{workspace.owner.email}</span>}
          </span>
        </div>
      </div>
    </aside>
  );
}
