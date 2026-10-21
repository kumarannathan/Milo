import { Component, useEffect, useState } from 'react';
import { Sidebar, NAV } from './components/Sidebar.jsx';
import { CommandPalette } from './components/CommandPalette.jsx';
import { Button, Spinner } from './components/ui.jsx';
import { useApp } from './lib/app-context.jsx';
import { useAuth } from './lib/auth.jsx';
import { navigate, useRoute } from './lib/router.js';
import ControlRoom from './pages/ControlRoom.jsx';
import Approvals from './pages/Approvals.jsx';
import Accounts from './pages/Accounts.jsx';
import AccountDetail from './pages/AccountDetail.jsx';
import Conversations from './pages/Conversations.jsx';
import Agents from './pages/Agents.jsx';
import Connections from './pages/Connections.jsx';
import Account from './pages/Account.jsx';
import Onboarding from './pages/Onboarding.jsx';
import AuthScreen from './pages/auth/AuthScreen.jsx';

// Screens that manage their own scrolling columns.
const FIXED = new Set(['approvals', 'conversations']);
const AUTH_PAGES = new Set(['signin', 'signup', 'reset']);

function pageFor(route) {
  switch (route.page) {
    case 'control-room':
      return <ControlRoom />;
    case 'approvals':
      return <Approvals selectedId={route.id} />;
    case 'accounts':
      return route.id ? <AccountDetail id={route.id} /> : <Accounts />;
    case 'conversations':
      return <Conversations selectedId={route.id} />;
    case 'agents':
      return <Agents agentId={route.id} />;
    case 'connections':
      return <Connections />;
    case 'account':
      return <Account />;
    default:
      return null;
  }
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('milo_theme', next ? 'dark' : 'light');
    } catch {}
    setDark(next);
  };
  return [dark, toggle];
}

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="empty">
          <span className="empty-title">This screen hit an error</span>
          <span className="empty-text mono">{String(this.state.error.message ?? this.state.error)}</span>
          <div className="empty-actions">
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

function Boot({ children }) {
  return <div className="boot">{children}</div>;
}

export function App() {
  const route = useRoute();
  const auth = useAuth();
  const app = useApp();
  const [dark, toggleTheme] = useTheme();

  const allowed = app.playbook?.nav ?? [];
  const page = allowed.includes(route.page) || (route.page === 'account' && app.workspace) ? route.page : 'control-room';

  useEffect(() => {
    if (app.workspace && !AUTH_PAGES.has(route.page) && route.page !== page) navigate(`/${page}`, { replace: true });
  }, [app.workspace, route.page, page]);

  useEffect(() => {
    const label = !auth.user ? 'Sign in' : app.workspace ? NAV[page]?.label : 'Welcome';
    document.title = label ? `${label} · Milo` : 'Milo';
  }, [page, app.workspace, auth.user]);

  if (auth.loading || !app.ready) {
    return (
      <Boot>
        {auth.error || app.error ? (
          <span>Can’t reach the Milo server. Start it with npm start, then reload.</span>
        ) : (
          <>
            <Spinner /> Loading
          </>
        )}
      </Boot>
    );
  }

  if (!auth.user) return <AuthScreen mode={AUTH_PAGES.has(route.page) ? route.page : 'signin'} />;
  if (!app.workspace) return <Onboarding />;

  return (
    <div className="app">
      <Sidebar active={page} dark={dark} onToggleTheme={toggleTheme} />
      <CommandPalette dark={dark} onToggleTheme={toggleTheme} />
      <div className={FIXED.has(page) ? 'main main-fixed' : 'main'}>
        <ErrorBoundary resetKey={`${page}/${route.id ?? ''}`}>
          <PageFrame key={`${page}/${route.id ?? ''}`}>{pageFor({ ...route, page })}</PageFrame>
        </ErrorBoundary>
      </div>
    </div>
  );
}

// Keyed per route so every screen fades in on navigation.
function PageFrame({ children }) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return children;
}
