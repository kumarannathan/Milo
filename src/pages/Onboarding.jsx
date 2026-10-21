import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useResource } from '../lib/live.js';
import { useToast } from '../components/feedback.jsx';
import { ConnectionForm, ProviderPicker } from '../components/ConnectionForm.jsx';
import { Button, Field, Input, Textarea } from '../components/ui.jsx';
import './onboarding.css';

// Three screens: name the workspace, connect a model, say what you sell. Sample data skips to the end.
export default function Onboarding() {
  const app = useApp();
  const auth = useAuth();
  const toast = useToast();
  const pb = app.playbooks[0];
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [settings, setSettings] = useState({});
  const [provider, setProvider] = useState(null);
  const [busy, setBusy] = useState(false);
  const conns = useResource('/api/connections', ['connections']);

  const required = useMemo(() => (pb?.settings ?? []).filter((f) => f.required), [pb]);
  const missing = required.filter((f) => !String(settings[f.key] ?? '').trim());
  const modelProviders = app.providers.filter((p) => p.playbooks.includes(pb?.id) && p.capabilities.includes('llm.complete') && p.id !== 'demo');
  const hasModel = (conns.data?.connections ?? []).some((c) => c.capabilities.includes('llm.complete'));

  async function finish(demo, values = settings) {
    setBusy(true);
    try {
      await api.post('/api/setup', {
        playbook: pb.id,
        demo,
        name: name.trim() || undefined,
        settings: demo ? {} : values,
        owner: { name: auth.user?.name, email: auth.user?.email },
      });
      await app.refreshWorkspace();
      window.location.hash = '#/control-room';
    } catch (err) {
      toast(err.message, { tone: 'error', duration: 6000 });
      setBusy(false);
    }
  }

  if (!pb) return null;
  const sender = settings.senderName === undefined ? auth.user?.name ?? '' : settings.senderName;
  const senderEmail = settings.senderEmail === undefined ? auth.user?.email ?? '' : settings.senderEmail;
  const field = (key, v) => setSettings((s) => ({ ...s, [key]: v }));

  return (
    <div className="onb">
      <header className="onb-top">
        <span className="sidebar-wordmark">Milo</span>
        <span className="onb-progress" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <i key={i} className={i <= step ? 'on' : ''} />
          ))}
        </span>
      </header>

      <main className="onb-main">
        {step === 0 && (
          <section className="onb-card" key="name">
            <h1>Name your workspace</h1>
            <Field label="Workspace name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme outbound" autoFocus />
            </Field>
            <div className="onb-actions">
              <Button onClick={() => setStep(1)} disabled={!name.trim()}>
                Continue
              </Button>
              <button type="button" className="onb-link" onClick={() => finish(true)} disabled={busy}>
                Try it with sample data instead
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="onb-card onb-wide" key="model">
            <h1>Connect a model</h1>
            {provider ? (
              <ConnectionForm provider={provider} onCancel={() => setProvider(null)} onSaved={() => setProvider(null)} />
            ) : (
              <ProviderPicker providers={modelProviders} connections={conns.data?.connections ?? []} onPick={setProvider} />
            )}
            {!provider && (
              <div className="onb-actions">
                <Button onClick={() => setStep(2)} variant={hasModel ? 'primary' : 'outline'}>
                  {hasModel ? 'Continue' : 'Skip for now'}
                </Button>
                <button type="button" className="onb-link" onClick={() => setStep(0)}>
                  <ArrowLeft size={14} /> Back
                </button>
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="onb-card" key="about">
            <h1>What you sell</h1>
            <div className="form-grid">
              {required
                .filter((f) => !['senderName', 'senderEmail'].includes(f.key))
                .map((f) => (
                  <div key={f.key} className={f.type === 'textarea' ? 'span-2' : undefined}>
                    <Field label={f.label}>
                      {f.type === 'textarea' ? (
                        <Textarea rows={3} value={settings[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => field(f.key, e.target.value)} />
                      ) : (
                        <Input value={settings[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => field(f.key, e.target.value)} autoFocus />
                      )}
                    </Field>
                  </div>
                ))}
              <Field label="Send emails as">
                <Input value={sender} onChange={(e) => field('senderName', e.target.value)} placeholder="Jordan Reyes" />
              </Field>
              <Field label="From address">
                <Input type="email" value={senderEmail} onChange={(e) => field('senderEmail', e.target.value)} placeholder="sales@acme.com" />
              </Field>
            </div>
            <div className="onb-actions">
              <Button
                loading={busy}
                disabled={missing.some((f) => !['senderName', 'senderEmail'].includes(f.key)) || !sender.trim() || !senderEmail.trim()}
                onClick={() => finish(false, { ...settings, senderName: sender, senderEmail })}
              >
                Open my workspace
              </Button>
              <button type="button" className="onb-link" onClick={() => setStep(1)}>
                <ArrowLeft size={14} /> Back
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
