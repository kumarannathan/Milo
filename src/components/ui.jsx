import { forwardRef, useId } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { DOT, tagFor } from '../lib/tags.js';

const cx = (...parts) => parts.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size, loading = false, icon: Icon, className, children, disabled, ...rest }) {
  return (
    <button
      type="button"
      className={cx('btn', `btn-${variant}`, size && `btn-${size}`, loading && 'is-loading', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="spin" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, icon: Icon, className, size = 16, ...rest }) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      <Icon size={size} />
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      className="switch-control"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={checked ? 'switch on' : 'switch'}>
        <span className="switch-thumb" />
      </span>
      {label != null && <span>{label}</span>}
    </button>
  );
}

export function Checkbox({ checked, onChange, label, className }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-label={label}
      className={cx('checkbox', checked && 'checked', className)}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  );
}

export function Dot({ color = DOT.gray, size = 6, pulse = false, className }) {
  return (
    <span
      className={cx('dot', pulse && 'dot-pulse', className)}
      style={{ width: size, height: size, background: color, color }}
      aria-hidden="true"
    />
  );
}

// Rectangular colored chip. Pass `kind` + `value` to use the shared color map, or `color` + children.
export function Tag({ kind, value, color, children, className, title }) {
  const t = kind ? tagFor(kind, value) : { color: color ?? 'gray', label: children };
  return (
    <span className={cx('tag', `tag-${t.color}`, className)} title={title}>
      {children ?? t.label}
    </span>
  );
}

export function StatusPill({ color, children, pulse }) {
  return (
    <span className="status-pill">
      <Dot color={color} pulse={pulse} />
      {children}
    </span>
  );
}

export function Mono({ children, size = 'md', className }) {
  return <span className={cx('mono-badge', `mono-${size}`, className)}>{children}</span>;
}

export function Avatar({ name, initials, size = 28, solid = false }) {
  return (
    <span className={cx('avatar', solid && 'avatar-solid')} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials}
    </span>
  );
}

export function Panel({ title, hint, actions, children, className, flush = false, ...rest }) {
  return (
    <section className={cx('panel', className)} {...rest}>
      {(title || actions || hint) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {hint && <span className="panel-hint">{hint}</span>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : 'panel-body'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, children, eyebrow }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow}
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Banner({ tone = 'neutral', children, action }) {
  const color = { error: 'var(--destructive)', warning: 'var(--warning)', neutral: 'var(--idle)', success: 'var(--success)' }[tone];
  return (
    <div className={cx('banner', `banner-${tone}`)} role={tone === 'error' ? 'alert' : undefined}>
      <Dot color={color} size={8} />
      <span className="banner-text">{children}</span>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, actions, compact = false }) {
  return (
    <div className={cx('empty', compact && 'empty-compact')}>
      {Icon && (
        <span className="empty-icon">
          <Icon size={20} />
        </span>
      )}
      <span className="empty-title">{title}</span>
      {children && <span className="empty-text">{children}</span>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <EmptyState title="Couldn’t load this" actions={onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}>
      {error?.message ?? 'Something went wrong.'}
    </EmptyState>
  );
}

// Pill-style segmented control (Activity filters, Table/Board).
export function Segmented({ options, value, onChange, size = 'sm', label }) {
  return (
    <div className={cx('segmented', `segmented-${size}`)} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon size={14} />}
          {o.label}
          {o.count != null && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Underlined tabs (account stages).
export function UnderlineTabs({ options, value, onChange }) {
  return (
    <div className="utabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span className="utab-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, help, error, children, htmlFor, optional }) {
  return (
    <div className={cx('field', error && 'field-error')}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {optional && <span className="field-optional">Optional</span>}
        </label>
      )}
      {children}
      {error ? <span className="field-msg error-text">{error}</span> : help ? <span className="field-msg">{help}</span> : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('input', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('input', 'textarea', className)} {...rest} />;
});

export function Select({ value, onChange, options, className, ...rest }) {
  return (
    <span className={cx('select-wrap', className)}>
      <select className="input select-native" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) =>
          o.group ? (
            <optgroup key={o.group} label={o.group}>
              {o.options.map((x) => (
                <option key={x.value} value={x.value} disabled={x.disabled}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ),
        )}
      </select>
    </span>
  );
}

export function LabeledInput({ label, help, error, optional, ...rest }) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} htmlFor={id} optional={optional}>
      {rest.type === 'textarea' ? <Textarea id={id} {...rest} /> : <Input id={id} {...rest} />}
    </Field>
  );
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function ScoreBar({ value, max = 100, muted = false }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <span className={cx('scorebar', muted && 'scorebar-muted')}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

// Seven tiny bars, the last one highlighted.
export function Bars({ values = [], height = 20 }) {
  const max = Math.max(...values, 1);
  return (
    <span className="bars" style={{ height }} aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={i === values.length - 1 ? 'bar bar-now' : 'bar'}
          style={{ height: Math.max(2, Math.round((v / max) * height)), animationDelay: `${i * 30}ms` }}
        />
      ))}
    </span>
  );
}

export function Skeleton({ width = '100%', height = 14, radius = 4, className }) {
  return <span className={cx('skeleton', className)} style={{ width, height, borderRadius: radius }} />;
}

export function SkeletonRows({ rows = 6, height = 36 }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height - 16} width={`${88 - ((i * 13) % 30)}%`} />
      ))}
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="spin" aria-label="Loading" />;
}

export { cx };
