import sales from './sales/index.js';
import markets from './markets/index.js';

const ALL = { sales, markets };

// Which playbooks this deployment offers. MILO_PLAYBOOKS=sales,markets enables both; the product ships sales only.
export const PLAYBOOKS = {};
export function enablePlaybooks(ids) {
  for (const k of Object.keys(PLAYBOOKS)) delete PLAYBOOKS[k];
  for (const id of ids) if (ALL[id]) PLAYBOOKS[id] = ALL[id];
  return PLAYBOOKS;
}
enablePlaybooks((process.env.MILO_PLAYBOOKS ?? 'sales').split(',').map((s) => s.trim()).filter(Boolean));

export function getPlaybook(id) {
  return PLAYBOOKS[id] ?? null;
}

export function describeAgent(def) {
  return {
    id: def.id,
    name: def.name,
    mono: def.mono,
    job: def.job,
    consumes: def.consumes ?? [],
    produces: def.produces ?? [],
    schedule: def.schedule,
    capabilities: def.capabilities ?? [],
    config: def.config ?? [],
  };
}

export function describePlaybook(pb) {
  return {
    id: pb.id,
    name: pb.name,
    tagline: pb.tagline,
    nav: pb.nav,
    autonomy: pb.autonomy,
    defaultAutonomy: pb.defaultAutonomy,
    settings: pb.settings,
    demo: { name: pb.demo.name },
    agents: pb.agents.map(describeAgent),
  };
}
