import scout from './agents/scout.js';
import researcher from './agents/researcher.js';
import prospector from './agents/prospector.js';
import qualifier from './agents/qualifier.js';
import personalizer from './agents/personalizer.js';
import sdr from './agents/sdr.js';
import crm from './agents/crm.js';
import { registerSalesRoutes, salesStats } from './routes.js';
import { approve, enrich, reject } from './approvals.js';

export default {
  id: 'sales',
  name: 'Sales development',
  tagline: 'Find accounts, research them, write outreach you approve, book meetings.',
  agents: [scout, researcher, prospector, qualifier, personalizer, sdr, crm],
  nav: ['control-room', 'approvals', 'accounts', 'conversations', 'agents', 'connections', 'account'],

  autonomy: [
    {
      id: 'review_sends',
      label: 'Review sends only',
      description: 'Research, scoring and CRM updates run on their own. Every email, reply and invite waits for you.',
    },
    {
      id: 'review_first_touch',
      label: 'Review first touches',
      description: 'You approve the first email to each person. Follow-ups and replies go out on their own.',
    },
    {
      id: 'autopilot',
      label: 'Autopilot',
      description: 'Nothing waits for review. Escalations still come to you.',
    },
  ],
  defaultAutonomy: 'review_sends',

  // Shown in setup and Settings. Agents read these through ctx.settings.
  settings: [
    { key: 'company', label: 'Your company', type: 'text', required: true, placeholder: 'Ledgerline', section: 'Company' },
    { key: 'product', label: 'What you sell', type: 'textarea', required: true, placeholder: 'Prior-auth automation for provider groups', section: 'Company' },
    { key: 'proofPoints', label: 'Proof points', type: 'textarea', placeholder: 'Lakeshore Physicians: prior-auth turnaround from 5 days to 9 hours', help: 'Customer results agents can cite. One per line.', section: 'Company' },
    { key: 'pricingNotes', label: 'Pricing notes', type: 'textarea', placeholder: 'Per provider per month. Groups of 5–10 locations land at $1,800–2,400.', help: 'Used when someone asks about price.', section: 'Company' },
    { key: 'industries', label: 'Industries', type: 'text', placeholder: 'Hospitals, physician groups, dental groups', section: 'Ideal customer' },
    { key: 'employeesMin', label: 'Employees from', type: 'number', placeholder: '500', section: 'Ideal customer' },
    { key: 'employeesMax', label: 'Employees to', type: 'number', placeholder: '5000', section: 'Ideal customer' },
    { key: 'locations', label: 'Locations', type: 'text', placeholder: 'United States', section: 'Ideal customer' },
    { key: 'titles', label: 'Who to contact', type: 'text', placeholder: 'VP Revenue Cycle, Director of Patient Access, CFO', section: 'Ideal customer' },
    { key: 'senderName', label: 'Sender name', type: 'text', required: true, placeholder: 'Jordan Reyes', section: 'Sending' },
    { key: 'senderEmail', label: 'Sender email', type: 'email', required: true, placeholder: 'sales@yourcompany.com', section: 'Sending' },
    { key: 'signature', label: 'Signature', type: 'textarea', placeholder: 'Jordan Reyes\nLedgerline', section: 'Sending' },
    { key: 'bookingUrl', label: 'Booking link', type: 'url', placeholder: 'https://cal.com/jordan/20min', help: 'Used when no calendar is connected.', section: 'Sending' },
  ],

  demo: {
    name: 'Ledgerline outbound',
    kickoff: ['scout'],
    settings: {
      company: 'Ledgerline',
      product: 'Prior-authorization automation for provider groups. We take over prior-auth submissions and payer follow-up.',
      proofPoints: 'Lakeshore Physicians: prior-auth turnaround from 5 days to 9 hours without new hires\nLakeshore recovered $2.1M in denied claims in six months',
      pricingNotes: 'Per provider per month. A 9-location group usually lands between $1,800 and $2,400 a month.',
      industries: 'Hospitals, physician groups, dental groups, diagnostics labs, home health',
      employeesMin: 300,
      employeesMax: 5000,
      locations: 'United States',
      titles: 'VP Revenue Cycle, Director of Patient Access, Head of RevOps, CFO, COO',
      senderName: 'Jordan Reyes',
      senderEmail: 'sales@ledgerline.io',
      signature: 'Jordan Reyes\nLedgerline',
      bookingUrl: 'https://cal.com/ledgerline/20min',
    },
  },

  approvals: { enrich, approve, reject },
  stats: salesStats,
  routes: registerSalesRoutes,
};
