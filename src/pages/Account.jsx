import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useAuth } from '../lib/auth.jsx';
import { ConfirmDialog, useAction } from '../components/feedback.jsx';
import { Button, Field, Input, PageHeader, Panel, Textarea, cx } from '../components/ui.jsx';
import './account.css';

function useDraft(source) {
  const [draft, setDraft] = useState(source);
  const key = JSON.stringify(source);
  useEffect(() => setDraft(source), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [draft, setDraft, JSON.stringify(draft) !== key];
}

export default function Account() {
  const app = useApp();
  const auth = useAuth();
  const ws = app.workspace;
  const pb = app.playbook;
  const local = auth.user?.id !== 'local';

  const [profile, setProfile, profileDirty] = useDraft({ name: auth.user?.name ?? '', email: auth.user?.email ?? '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [wsName, setWsName, wsDirty] = useDraft({ name: ws.name });
  const [settings, setSettings, settingsDirty] = useDraft(Object.fromEntries(pb.settings.map((f) => [f.key, ws.settings?.[f.key] ?? ''])));
  const [workers, setWorkers] = useState(ws.settings?.workers ?? 3);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const [saveProfile, savingProfile] = useAction(() => auth.update(profile), { success: 'Profile saved.' });
  const [savePassword, savingPassword] = useAction(() => auth.update({ currentPassword: pw.current, newPassword: pw.next }), {
    success: 'Password changed.',
    onDone: () => setPw({ current: '', next: '' }),
  });
  const [saveWs, savingWs] = useAction(() => api.patch('/api/workspace', { name: wsName.name }), { success: 'Workspace saved.' });
  const [saveSettings, savingSettings] = useAction(() => api.patch('/api/workspace', { settings }), { success: 'Saved.' });
  const [setAutonomy] = useAction((autonomy) => api.patch('/api/workspace', { autonomy }), { success: 'Saved.' });
  const [saveWorkers] = useAction((n) => api.patch('/api/workspace', { settings: { workers: Number(n) } }), { success: 'Saved.' });
  const [pause, pausing] = useAction(() => api.post(ws.paused ? '/api/workspace/resume' : '/api/workspace/pause'), {
    success: () => (ws.paused ? 'Team resumed.' : 'Team paused.'),
  });
  const [reset, resetting] = useAction(() => api.del('/api/workspace', { confirm: confirmName }), {
    onDone: () => {
      window.location.hash = '#/';
      app.refreshWorkspace();
    },
  });

  const sections = {};
  for (const f of pb.settings) (sections[f.section ?? 'General'] ??= []).push(f);

  return (
    <div className="page">
      <PageHeader title="Account" />
      <div className="page-body account">
        <Panel title="Profile">
          <div className="form-grid">
            <Field label="Name">
              <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} disabled={!local} />
            </Field>
            <Field label="Email">
              <Input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} disabled={!local} />
            </Field>
          </div>
          {local && (
            <div className="account-actions">
              <Button onClick={() => saveProfile()} loading={savingProfile} disabled={!profileDirty}>
                Save
              </Button>
            </div>
          )}
        </Panel>

        {local && (
          <Panel title="Password">
            <div className="form-grid">
              <Field label="Current password">
                <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </Field>
              <Field label="New password">
                <Input type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </Field>
            </div>
            <div className="account-actions">
              <Button variant="outline" onClick={() => savePassword()} loading={savingPassword} disabled={!pw.current || pw.next.length < 8}>
                Change password
              </Button>
            </div>
          </Panel>
        )}

        <Panel title="Workspace">
          <div className="form-grid">
            <Field label="Name">
              <Input value={wsName.name} onChange={(e) => setWsName({ name: e.target.value })} />
            </Field>
          </div>
          <div className="account-actions">
            <Button onClick={() => saveWs()} loading={savingWs} disabled={!wsDirty}>
              Save
            </Button>
          </div>
        </Panel>

        <Panel title="Approvals">
          <div className="autonomy-list">
            {pb.autonomy.map((a) => (
              <button key={a.id} type="button" className={cx('autonomy-card', ws.autonomy === a.id && 'selected')} onClick={() => ws.autonomy !== a.id && setAutonomy(a.id)} aria-pressed={ws.autonomy === a.id}>
                <span className={cx('radio', ws.autonomy === a.id && 'on')} />
                <span className="autonomy-text">
                  <span className="strong">{a.label}</span>
                  <span className="muted small">{a.description}</span>
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Outreach">
          <div className="account-sections">
            {Object.entries(sections).map(([section, fields]) => (
              <div key={section} className="form-section">
                <span className="form-section-title">{section}</span>
                <div className="form-grid">
                  {fields.map((f) => (
                    <div key={f.key} className={f.type === 'textarea' ? 'span-2' : undefined}>
                      <Field label={f.label} optional={!f.required}>
                        {f.type === 'textarea' ? (
                          <Textarea rows={3} value={settings[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} />
                        ) : (
                          <Input
                            type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
                            value={settings[f.key] ?? ''}
                            placeholder={f.placeholder}
                            onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
                          />
                        )}
                      </Field>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="account-actions">
            <Button onClick={() => saveSettings()} loading={savingSettings} disabled={!settingsDirty}>
              Save
            </Button>
          </div>
        </Panel>

        <Panel title="Team">
          <div className="account-row">
            <span className="strong account-row-text">Agents running at once</span>
            <Input type="number" min={1} max={10} value={workers} onChange={(e) => setWorkers(e.target.value)} className="account-num" />
            <Button variant="outline" onClick={() => saveWorkers(workers)} disabled={Number(workers) === (ws.settings?.workers ?? 3)}>
              Save
            </Button>
          </div>
          <div className="account-row">
            <span className="strong account-row-text">{ws.paused ? 'Paused' : 'Running'}</span>
            <Button variant={ws.paused ? 'primary' : 'outline'} icon={ws.paused ? Play : Pause} onClick={() => pause()} loading={pausing}>
              {ws.paused ? 'Resume team' : 'Pause team'}
            </Button>
          </div>
          <div className="account-row">
            <span className="strong account-row-text">Export data</span>
            <a className="btn btn-outline" href="/api/export" download>
              Download JSON
            </a>
          </div>
        </Panel>

        <Panel title="Danger zone" className="danger-panel">
          <div className="account-row">
            <span className="account-row-text">
              <span className="strong">Reset workspace</span>
              <span className="muted small">Deletes connections, agents’ work and settings. Your account stays.</span>
            </span>
            <Button variant="destructive" onClick={() => setResetOpen(true)}>
              Reset
            </Button>
          </div>
          <div className="account-row">
            <span className="strong account-row-text">Sign out</span>
            <Button variant="outline" onClick={() => auth.signOut()}>
              Sign out
            </Button>
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setConfirmName('');
        }}
        onConfirm={() => reset()}
        busy={resetting}
        destructive
        title="Reset this workspace?"
        description={`Type ${ws.name} to confirm. This can’t be undone.`}
        confirmLabel="Reset workspace"
      >
        <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={ws.name} />
      </ConfirmDialog>
    </div>
  );
}
