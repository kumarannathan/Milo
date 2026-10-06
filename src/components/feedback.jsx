import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, Dot } from './ui.jsx';

// ── Toasts ─────────────────────────────────────────────────────

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 180);
  }, []);

  const toast = useCallback(
    (message, { tone = 'neutral', action, duration = 4000 } = {}) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, message, tone, action }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={t.leaving ? 'toast leaving' : 'toast'}>
              <Dot color={t.tone === 'error' ? 'var(--destructive)' : t.tone === 'success' ? 'var(--success)' : 'var(--idle)'} />
              <span className="toast-text">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    t.action.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Run an API action, toasting its error. Returns [run, busy].
export function useAction(fn, { success, onDone } = {}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (...args) => {
      setBusy(true);
      try {
        const result = await fn(...args);
        if (success) toast(typeof success === 'function' ? success(result, ...args) : success, { tone: 'success' });
        onDone?.(result);
        return result;
      } catch (err) {
        toast(err?.message ?? 'Something went wrong.', { tone: 'error', duration: 6000 });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, toast],
  );
  return [run, busy];
}

// ── Dialog ─────────────────────────────────────────────────────

export function Dialog({ open, onClose, title, description, children, footer, width = 520 }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 180);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Prefer the first field, then the main action; the close button is a last resort.
      const target = ['.dialog-body input:not([type=hidden]), .dialog-body textarea, .dialog-body select', '.dialog-foot .btn-primary, .dialog-foot .btn-destructive', 'button']
        .map((sel) => panel.querySelector(sel))
        .find(Boolean);
      target?.focus();
    }, 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className={visible ? 'dialog-root open' : 'dialog-root'}>
      <div className="dialog-scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width }} ref={panelRef}>
        <div className="dialog-head">
          <div className="dialog-titles">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', destructive = false, busy = false, children }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={440}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
