import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Database, KeyRound, Moon, Sun } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useResource } from '../lib/live.js';
import { Button, Field, Input, LabeledInput, Mono, Switch, Tag, Textarea, cx } from '../components/ui.jsx';
import { ConnectionForm, ProviderPicker } from '../components/ConnectionForm.jsx';
import { useToast } from '../components/feedback.jsx';
import './setup.css';

const STEPS_OWN = ['Playbook', 'Start', 'About you', 'Agents', 'Connections', 'Review'];
const STEPS_DEMO = ['Playbook', 'Start', 'Review'];

export default function Setup() {
  const app = useApp();
  const toast = useToast();
  const playbooks = app.meta?.playbooks ?? [];
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [playbookId, setPlaybookId] = useState(null);
  const [mode, setMode] = useState(null); // 'demo' | 'own'
  const [name, setName] = useState('');
  const [settings, setSettings] = useState({});
  const [agents, setAgents] = useState(new Set());
  const [autonomy, setAutonomy] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const pb = playbooks.find((p) => p.id === playbookId);
  const steps = mode === 'demo' ? STEPS_DEMO : STEPS_OWN;
  const stepName = steps[step];

  useEffect(() => {
    if (!pb) return;
    setAgents(new Set(pb.agents.map((a) => a.id)));
    setAutonomy(pb.defaultAutonomy);
  }, [pb]);

  useEffect(() => {
    if (pb) setName(mode === 'demo' ? pb.demo.name : '');
  }, [pb, mode]);

  function go(delta) {
    setDir(delta);
    setStep((s) => Math.max(0, Math.min(steps.length - 1, s + delta)));
  }

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('milo_theme', next ? 'dark' : 'light');
    } catch {}
    setDark(next);
  }

  const missingSettings = pb ? pb.settings.filter((f) => f.required && !String(settings[f.key] ?? '').trim()) : [];

  async function finish() {
    setBusy(true);
    try {
      await api.post('/api/setup', {
        playbook: pb.id,
        demo: mode === 'demo',
        name: name.trim() || undefined,
        settings: mode === 'demo' ? {} : settings,
        agents: [...agents],
        autonomy,
        owner: mode === 'demo' ? undefined : { name: settings.senderName || settings.ownerName || 'You', email: settings.senderEmail || '' },
      });
      await app.refreshWorkspace();
      window.location.hash = '#/control-room';
    } catch (err) {
      toast(err.message, { tone: 'error', duration: 6000 });
      setBusy(false);
    }
  }

  const canNext =
    (stepName === 'Playbook' && pb) ||
    (stepName === 'Start' && mode) ||
    (stepName === 'About you' && missingSettings.length === 0) ||
    (stepName === 'Agents' && agents.size > 0) ||
    stepName === 'Connections';

  return (
    <div className="setup">
      <header className="setup-top">
        <span className="sidebar-wordmark">Milo</span>
        <ol className="setup-steps" aria-label="Setup progress">
          {steps.map((s, i) => (
            <li key={s} className={cx(i === step && 'current', i < step && 'done')}>
              <span className="setup-step-dot">{i < step ? <Check size={10} strokeWidth={3} /> : i + 1}</span>
              {s}
              {i < steps.length - 1 && <ChevronRight size={14} className="muted" />}
            </li>
          ))}
        </ol>
        <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={dark ? 'Light theme' : 'Dark theme'}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <main className="setup-main">
        <div key={stepName} className={dir > 0 ? 'setup-step step-forward' : 'setup-step step-back'}>
          {stepName === 'Playbook' && <PlaybookStep playbooks={playbooks} value={playbookId} onChange={setPlaybookId} />}
          {stepName === 'Start' && <ModeStep pb={pb} value={mode} onChange={setMode} />}
          {stepName === 'About you' && <AboutStep pb={pb} name={name} setName={setName} settings={settings} setSettings={setSettings} />}
          {stepName === 'Agents' && <AgentsStep pb={pb} agents={agents} setAgents={setAgents} />}
          {stepName === 'Connections' && <ConnectionsStep pb={pb} agents={agents} />}
          {stepName === 'Review' && (
            <ReviewStep pb={pb} mode={mode} name={name} setName={setName} agents={agents} autonomy={autonomy} setAutonomy={setAutonomy} />
          )}
        </div>
      </main>

      <footer className="setup-foot">
        <div className="setup-foot-inner">
          {step > 0 ? (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => go(-1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {stepName === 'About you' && missingSettings.length > 0 && (
            <span className="muted small">Fill in {missingSettings.map((f) => f.label.toLowerCase()).join(', ')}.</span>
          )}
          {stepName === 'Review' ? (
            <Button onClick={finish} loading={busy}>
              {mode === 'demo' ? 'Start with sample data' : 'Start agents'}
            </Button>
          ) : (
            <Button onClick={() => go(1)} disabled={!canNext}>
              Continue <ArrowRight size={16} />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function PlaybookStep({ playbooks, value, onChange }) {
  return (
    <div className="setup-section">
      <h1>Pick a playbook</h1>
      <p className="setup-lead">Each playbook is a team of agents that hand work to each other. You can change agents and connections later.</p>
      <div className="playbook-grid">
        {playbooks.map((p) => (
          <button key={p.id} type="button" className={cx('playbook-card', value === p.id && 'selected')} onClick={() => onChange(p.id)} aria-pressed={value === p.id}>
            <span className="playbook-card-head">
              <span className="playbook-name">{p.name}</span>
              <span className={cx('radio', value === p.id && 'on')} />
            </span>
            <span className="playbook-tagline">{p.tagline}</span>
            <span className="playbook-pipeline">
              {p.agents.map((a, i) => (
                <span key={a.id} className="pipeline-step" style={{ animationDelay: `${i * 40}ms` }}>
                  <Mono size="sm">{a.mono}</Mono>
                  <span>{a.name}</span>
                  {i < p.agents.length - 1 && <ChevronRight size={12} className="muted" />}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeStep({ pb, value, onChange }) {
  const options = [
    {
      id: 'demo',
      icon: Database,
      title: 'Try it with sample data',
      body:
        pb.id === 'sales'
          ? 'Agents work on made-up healthcare companies with a built-in sample model. Emails go nowhere. No keys needed.'
          : 'Agents watch simulated markets with a built-in sample model. Paper trades only. No keys needed.',
    },
    {
      id: 'own',
      icon: KeyRound,
      title: 'Connect my own services',
      body: 'Describe what you do, choose agents, then add your keys. Each connection is tested before you start.',
    },
  ];
  return (
    <div className="setup-section">
      <h1>How do you want to start?</h1>
      <p className="setup-lead">Sample data is the fastest way to see the whole {pb.name.toLowerCase()} pipeline run. You can add real connections at any time.</p>
      <div className="mode-grid">
        {options.map((o) => (
          <button key={o.id} type="button" className={cx('mode-card', value === o.id && 'selected')} onClick={() => onChange(o.id)} aria-pressed={value === o.id}>
            <span className="mode-icon">
              <o.icon size={18} />
            </span>
            <span className="mode-title">{o.title}</span>
            <span className="mode-body">{o.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AboutStep({ pb, name, setName, settings, setSettings }) {
  const sections = useMemo(() => {
    const out = {};
    for (const f of pb.settings) (out[f.section ?? 'General'] ??= []).push(f);
    return out;
  }, [pb]);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="setup-section setup-form">
      <h1>{pb.id === 'sales' ? 'About your outreach' : 'About your desk'}</h1>
      <p className="setup-lead">Agents read this before they research, write or trade. Be specific.</p>
      <div className="form-section">
        <LabeledInput label="Workspace name" placeholder={pb.id === 'sales' ? 'Acme outbound' : 'Paper desk'} value={name} onChange={(e) => setName(e.target.value)} optional />
      </div>
      {Object.entries(sections).map(([section, fields]) => (
        <div key={section} className="form-section">
          <span className="form-section-title">{section}</span>
          <div className="form-grid">
            {fields.map((f) => (
              <div key={f.key} className={f.type === 'textarea' ? 'span-2' : undefined}>
                <Field label={f.label} help={f.help} optional={!f.required}>
                  {f.type === 'textarea' ? (
                    <Textarea rows={3} value={settings[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                  ) : (
                    <Input
                      type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
                      value={settings[f.key] ?? ''}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.key, f.type === 'number' ? e.target.value : e.target.value)}
                    />
                  )}
                </Field>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentsStep({ pb, agents, setAgents }) {
  const { capabilities } = useApp();
  const toggle = (id, on) =>
    setAgents((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <div className="setup-section">
      <h1>Choose your agents</h1>
      <p className="setup-lead">Agents hand work to the next one in line. Turning one off holds its work until you turn it back on.</p>
      <div className="setup-agents">
        {pb.agents.map((a, i) => (
          <div key={a.id} className={cx('setup-agent', agents.has(a.id) && 'on')} style={{ animationDelay: `${i * 35}ms` }}>
            <Mono>{a.mono}</Mono>
            <div className="setup-agent-text">
              <span className="strong">{a.name}</span>
              <span className="muted small">{a.job}</span>
              <span className="setup-agent-caps">
                {a.capabilities.map((c) => (
                  <Tag key={c.key} color={c.required ? 'blue' : 'gray'} title={c.required ? 'Required' : 'Optional'}>
                    {capabilities[c.key]?.label ?? c.key}
                  </Tag>
                ))}
              </span>
            </div>
            <Switch checked={agents.has(a.id)} onChange={(on) => toggle(a.id, on)} label={agents.has(a.id) ? 'On' : 'Off'} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionsStep({ pb, agents }) {
  const app = useApp();
  const conns = useResource('/api/connections', ['connections']);
  const connections = conns.data?.connections ?? [];
  const [adding, setAdding] = useState(null);
  const toast = useToast();

  const providers = app.providers.filter((p) => p.playbooks.includes(pb.id) && p.id !== 'demo');
  const required = new Map();
  for (const a of pb.agents) {
    if (!agents.has(a.id)) continue;
    for (const c of a.capabilities) {
      const entry = required.get(c.key) ?? { key: c.key, required: false, agents: [] };
      entry.required ||= c.required;
      entry.agents.push(a.name);
      required.set(c.key, entry);
    }
  }
  const coveredBy = (cap) => connections.find((c) => c.capabilities.includes(cap) && c.status === 'ok');
  const needed = new Set([...required.values()].filter((r) => r.required && !coveredBy(r.key)).map((r) => r.key));
  const missing = [...required.values()].filter((r) => r.required && !coveredBy(r.key));

  async function remove(id) {
    try {
      await api.del(`/api/connections/${id}`);
      conns.refresh();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }

  return (
    <div className="setup-section setup-wide">
      <h1>Connect your services</h1>
      <p className="setup-lead">Agents ask for actions like “Find companies” or “Send email”. Add a connection for each one they need. Keys stay on this machine.</p>

      <div className="setup-conn-layout">
        <div className="setup-conn-main">
          {adding ? (
            <div className="panel panel-pad rise-in">
              <ConnectionForm
                provider={adding}
                onCancel={() => setAdding(null)}
                onSaved={(c, opts) => {
                  conns.refresh();
                  if (!opts?.failed) {
                    toast(`${c.label} connected.`, { tone: 'success' });
                    setAdding(null);
                  }
                }}
              />
            </div>
          ) : (
            <ProviderPicker providers={providers} connections={connections} needed={needed} onPick={setAdding} />
          )}
        </div>

        <aside className="setup-coverage">
          <div className="panel">
            <div className="panel-head">
              <h2>What your agents need</h2>
            </div>
            <div className="rows">
              {[...required.values()].map((r) => {
                const conn = coveredBy(r.key);
                return (
                  <div key={r.key} className="row coverage-row">
                    <span className="coverage-text">
                      <span className="strong">{app.capabilities[r.key]?.label ?? r.key}</span>
                      <span className="muted small truncate">{conn ? conn.label : r.agents.join(', ')}</span>
                    </span>
                    <Tag color={conn ? 'green' : r.required ? 'red' : 'gray'}>{conn ? 'Covered' : r.required ? 'Needed' : 'Optional'}</Tag>
                  </div>
                );
              })}
            </div>
          </div>
          {connections.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <h2>Added</h2>
              </div>
              <div className="rows">
                {connections.map((c) => (
                  <div key={c.id} className="row coverage-row">
                    <span className="coverage-text">
                      <span className="strong">{c.label}</span>
                      <span className="muted small truncate">{c.account || c.lastError?.message}</span>
                    </span>
                    <button type="button" className="panel-link" onClick={() => remove(c.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {missing.length > 0 && (
            <p className="muted small">
              You can continue without these. Agents that need them stop with a clear message until you add one.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ReviewStep({ pb, mode, name, setName, agents, autonomy, setAutonomy }) {
  return (
    <div className="setup-section setup-form">
      <h1>{mode === 'demo' ? 'Ready to try it' : 'Ready to start'}</h1>
      <p className="setup-lead">
        {mode === 'demo'
          ? `${pb.agents[0].name} runs as soon as you start. The others pick up work as it arrives.`
          : 'Agents start on their schedules. You can pause the whole team from the control room.'}
      </p>
      <div className="form-section">
        <Field label="Workspace name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={pb.demo.name} />
        </Field>
      </div>
      <div className="form-section">
        <span className="form-section-title">What needs your approval</span>
        <div className="autonomy-list">
          {pb.autonomy.map((a) => (
            <button key={a.id} type="button" className={cx('autonomy-card', autonomy === a.id && 'selected')} onClick={() => setAutonomy(a.id)} aria-pressed={autonomy === a.id}>
              <span className={cx('radio', autonomy === a.id && 'on')} />
              <span className="autonomy-text">
                <span className="strong">{a.label}</span>
                <span className="muted small">{a.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="form-section">
        <span className="form-section-title">Agents</span>
        <div className="review-agents">
          {pb.agents.map((a) => (
            <span key={a.id} className={cx('review-agent', !agents.has(a.id) && 'off')}>
              <Mono size="sm">{a.mono}</Mono>
              {a.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
