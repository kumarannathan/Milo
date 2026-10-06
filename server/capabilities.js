// Actions agents can ask for. A connection serves a capability if its provider implements it.
// Agents never talk to a vendor directly; you choose which connection handles each action.

export const CAPABILITIES = {
  // Shared
  'llm.complete': { label: 'Write text', group: 'Models' },
  'web.search': { label: 'Search the web', group: 'Research' },
  'web.fetch': { label: 'Read web pages', group: 'Research' },
  'signals.news': { label: 'Track news', group: 'Research' },
  'notify.post': { label: 'Post alerts', group: 'Alerts' },

  // Sales development
  'accounts.search': { label: 'Find companies', group: 'Data' },
  'accounts.enrich': { label: 'Fill in company details', group: 'Data' },
  'contacts.search': { label: 'Find people', group: 'Data' },
  'contacts.enrich': { label: 'Fill in person details', group: 'Data' },
  'email.find': { label: 'Find work emails', group: 'Data' },
  'email.verify': { label: 'Verify emails', group: 'Data' },
  'signals.funding': { label: 'Track funding', group: 'Research' },
  'signals.hiring': { label: 'Track hiring', group: 'Research' },
  'social.search': { label: 'Search social posts', group: 'Research' },
  'crm.read': { label: 'Read the CRM', group: 'CRM' },
  'crm.write': { label: 'Update the CRM', group: 'CRM' },
  'email.send': { label: 'Send email', group: 'Email' },
  'email.read': { label: 'Read replies', group: 'Email' },
  'calendar.availability': { label: 'Check calendar', group: 'Calendar' },
  'calendar.book': { label: 'Book meetings', group: 'Calendar' },

  // Markets
  'markets.search': { label: 'Find markets', group: 'Markets' },
  'markets.quote': { label: 'Read prices', group: 'Markets' },
  'markets.trades': { label: 'Read trades', group: 'Markets' },
};

export function capabilityLabel(key) {
  return CAPABILITIES[key]?.label ?? key;
}
