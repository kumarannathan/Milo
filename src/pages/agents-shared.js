// Helpers shared by the Agents screen and anything else that edits agents.

export const SCHEDULE_PRESETS = [
  { value: 'event', label: 'When work arrives' },
  { value: '*/2 * * * *', label: 'Every 2 minutes' },
  { value: '*/5 * * * *', label: 'Every 5 minutes' },
  { value: '*/10 * * * *', label: 'Every 10 minutes' },
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '*/30 * * * *', label: 'Every 30 minutes' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */4 * * *', label: 'Every 4 hours' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9:00 AM' },
  { value: 'custom', label: 'Custom cron' },
];

// Options for an agent's model picker: workspace default plus every model on every LLM connection.
export function modelOptions(connections, providers, workspace) {
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
  const llms = connections.filter((c) => c.capabilities.includes('llm.complete'));
  const def = workspace?.defaultModel;
  const defConn = def ? llms.find((c) => c.id === def.connectionId) : llms[0];
  const defModel = def?.model || (defConn ? defConn.values?.model || byId[defConn.provider]?.defaultModel : null);
  const options = [{ value: '', label: defConn ? `Workspace default · ${defModel ?? defConn.label}` : 'Workspace default' }];
  for (const c of llms) {
    const provider = byId[c.provider];
    const models = new Set([...(provider?.models ?? []), c.values?.model].filter(Boolean));
    options.push({
      group: c.label,
      options: [...models].map((m) => ({ value: `${c.id}::${m}`, label: `${provider?.name ?? c.label} · ${m}` })),
    });
  }
  return options;
}

export function encodeModel(model) {
  return model?.override ? `${model.connectionId}::${model.model}` : '';
}

export function decodeModel(value) {
  if (!value) return null;
  const [connectionId, ...rest] = value.split('::');
  return { connectionId, model: rest.join('::') };
}

export function configValueLabel(field) {
  const v = field.value;
  if (field.type === 'boolean') return v ? 'Yes' : 'No';
  if (field.type === 'select') return field.options?.find((o) => o.value === v)?.label ?? String(v);
  if (v === '' || v == null) return '—';
  let text = field.type === 'number' ? Number(v).toLocaleString('en-US') : String(v);
  if (field.prefix) text = field.prefix === '$' ? `$${text}` : `${field.prefix} ${text}`;
  if (field.suffix) text += /^[:%+−]/.test(field.suffix) ? field.suffix : ` ${field.suffix}`;
  return text;
}
