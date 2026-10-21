import { useEffect, useRef, useState } from 'react';
import { LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { Avatar } from './ui.jsx';
import { initials } from '../lib/format.js';

// The person at the bottom of the sidebar: Account, theme, sign out.
export function UserMenu({ dark, onToggleTheme }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const user = auth.user;
  return (
    <div className="user-menu" ref={ref}>
      {open && (
        <div className="user-pop" role="menu">
          <a href="#/account" className="nav-item" role="menuitem" onClick={() => setOpen(false)}>
            <UserRound size={16} strokeWidth={1.75} />
            <span className="nav-label">Account</span>
          </a>
          <button type="button" className="nav-item" role="menuitem" onClick={onToggleTheme}>
            {dark ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
            <span className="nav-label">{dark ? 'Light theme' : 'Dark theme'}</span>
          </button>
          {user?.id !== 'local' && (
            <button type="button" className="nav-item" role="menuitem" onClick={() => auth.signOut()}>
              <LogOut size={16} strokeWidth={1.75} />
              <span className="nav-label">Sign out</span>
            </button>
          )}
        </div>
      )}
      <button type="button" className="user-row" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar initials={initials(user?.name)} size={28} />
        <span className="user-text">
          <span className="user-name">{user?.name}</span>
          {user?.email && <span className="user-email">{user.email}</span>}
        </span>
      </button>
    </div>
  );
}
