import scanner from './agents/scanner.js';
import whales from './agents/whales.js';
import analyst from './agents/analyst.js';
import trader from './agents/trader.js';
import bookkeeper from './agents/bookkeeper.js';
import { registerMarketsRoutes, marketsStats } from './routes.js';
import { tradeApprovals } from './approvals.js';

export default {
  id: 'markets',
  name: 'Markets',
  tagline: 'Watch prediction markets, follow large trades, research the odds, paper-trade the edge.',
  agents: [scanner, whales, analyst, trader, bookkeeper],
  nav: ['control-room', 'approvals', 'markets', 'positions', 'agents', 'connections', 'account'],

  autonomy: [
    {
      id: 'review_trades',
      label: 'Review trades',
      description: 'Agents research and propose. Every trade waits for you.',
    },
    {
      id: 'autopilot',
      label: 'Autopilot',
      description: 'Trader opens and closes paper positions on its own, within your limits.',
    },
  ],
  defaultAutonomy: 'review_trades',

  settings: [
    { key: 'startingBalance', label: 'Paper bankroll', type: 'number', required: true, placeholder: '1000', help: 'Simulated dollars. No real money moves.', section: 'Account' },
    { key: 'focus', label: 'Topics to focus on', type: 'text', placeholder: 'Elections, Fed, AI, sports', help: 'Scanner adds these first.', section: 'Account' },
  ],

  demo: {
    name: 'Paper desk',
    kickoff: ['scanner'],
    settings: { startingBalance: 1000, focus: '' },
  },

  stats: marketsStats,
  routes: registerMarketsRoutes,
  approvals: tradeApprovals,
};
