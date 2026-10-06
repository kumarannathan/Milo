import { useEffect, useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { ConfirmDialog, useAction } from '../components/feedback.jsx';
import { Button, Field, Input, PageHeader, Panel, Textarea, cx } from '../components/ui.jsx';
import './settings.css';

function useDraft(source) {
  const [draft, setDraft] = useState(source);
  const key = JSON.stringify(source);
  useEffect(() => setDraft(source), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== key;
  return [draft, setDraft, dirty];
}

export default function Settings() {
  const app = useApp();
  const ws = app.workspace;
  const pb = app.playbook;

  const [general, setGeneral, generalDirty] = useDraft({ name: ws.name, ownerName: ws.owner?.name ?? '', ownerEmail: ws.owner?.email ?? '' });
  const playbookKeys = pb.settings.map((f) => f.key);
  const [settings, setSettings, settingsDirty] = useDraft(Object.fromEntries(playbookKeys.map((k) => [k, ws.settings?.[k] ?? ''])));
  const [workers, setWorkers] = useState(ws.settings?.workers ?? 3);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const [saveGeneral, savingGeneral] = useAction(
    () => api.patch('/api/workspace', { name: general.name, owner: { name: general.ownerName, email: general.ownerEmail } }),
    { success: 'Workspace saved.' },
  );
  const [saveSettings, savingSettings] = useAction(() => api.patch('/api/workspace', { settings }), { success: 'Saved. Agents use this from their next run.' });
  const [setAutonomy] = useAction((autonomy) => api.patch('/api/workspace', { autonomy }), { success: 'Approval rules updated.' });
  const [saveWorkers] = useAction((n) => api.patch('/api/workspace', { settings: { workers: Number(n) } }), { success: 'Runner updated.' });
  const [pause, pausing] = useAction(() => api.post(ws.paused ? '/api/workspace/resume' : '/api/workspace/pause'), {
    success: () => (ws.paused ? 'Team resumed.' : 'Team paused. Nothing runs until you resume.'),
  });
  const [reset, resetting] = useAction(() => api.del('/api/workspace', { confirm: confirmName }), {
    onDone: () => {
      window.location.hash = '#/';
      app.refreshWorkspace();
    },
  });

  const sections = useMemo(() => {
    const out = {};
    for (const f of pb.settings) (out[f.section ?? 'General'] ??= []).push(f);
    return out;
  }, [pb]);

  return (
    <div className="page">
      <PageHeader title="Settings" sub={`${pb.name}${ws.demo ? ' · sample data' : ''}`} />
      <div className="page-body settings">
        <Panel title="Workspace">
          <div className="form-grid">
            <Field label="Name">
              <Input value={general.name} onChange={(e) => setGeneral({ ...general, name: e.target.value })} />
            </Field>
            <span />
            <Field label="Your name" help="Shown on the control room and used for escalations.">
              <Input value={general.ownerName} onChange={(e) => setGeneral({ ...general, ownerName: e.target.value })} />
            </Field>
            <Field label="Your email">
              <Input type="email" value={general.ownerEmail} onChange={(e) => setGeneral({ ...general, ownerEmail: e.target.value })} />
            </Field>
          </div>
          <div className="settings-actions">
            <Button onClick={() => saveGeneral()} loading={savingGeneral} disabled={!generalDirty}>
              Save
            </Button>
          </div>
        </Panel>

        <Panel title="Approvals" hint="What waits for you before it goes out.">
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

        <Panel title={pb.id === 'sales' ? 'Outreach' : 'Desk'} hint="Agents read these before they research, write or trade.">
          <div className="settings-sections">
            {Object.entries(sections).map(([section, fields]) => (
              <div key={section} className="form-section">
                <span className="form-section-title">{section}</span>
                <div className="form-grid">
                  {fields.map((f) => (
                    <div key={f.key} className={f.type === 'textarea' ? 'span-2' : undefined}>
                      <Field label={f.label} help={f.help} optional={!f.required}>
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
          <div className="settings-actions">
            <Button onClick={() => saveSettings()} loading={savingSettings} disabled={!settingsDirty}>
              Save
            </Button>
          </div>
        </Panel>

        <Panel title="Runner">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="strong">Workers</span>
              <span className="muted small">How many agents can run at the same time.</span>
            </div>
            <Input type="number" min={1} max={10} value={workers} onChange={(e) => setWorkers(e.target.value)} className="settings-num" />
            <Button variant="outline" onClick={() => saveWorkers(workers)} disabled={Number(workers) === (ws.settings?.workers ?? 3)}>
              Save
            </Button>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="strong">{ws.paused ? 'The team is paused' : 'Pause the team'}</span>
              <span className="muted small">{ws.paused ? 'Queued work is held. Nothing runs or sends until you resume.' : 'Stops every agent after its current step. Queued work is kept.'}</span>
            </div>
            <Button variant={ws.paused ? 'primary' : 'outline'} icon={ws.paused ? Play : Pause} onClick={() => pause()} loading={pausing}>
              {ws.paused ? 'Resume team' : 'Pause team'}
            </Button>
          </div>
        </Panel>

        <Panel title="Data">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="strong">Export</span>
              <span className="muted small">Download everything Milo has stored as JSON. Connection keys are left out.</span>
            </div>
            <a className="btn btn-outline" href="/api/export" download>
              Download export
            </a>
          </div>
        </Panel>

        <Panel title="Reset" className="danger-panel">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="strong">Start over</span>
              <span className="muted small">Deletes this workspace, its connections and everything the agents found. This can’t be undone.</span>
            </div>
            <Button variant="destructive" onClick={() => setResetOpen(true)}>
              Reset workspace
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
        description={`Type ${ws.name} to confirm.`}
        confirmLabel="Reset workspace"
      >
        <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={ws.name} />
      </ConfirmDialog>
    </div>
  );
}
