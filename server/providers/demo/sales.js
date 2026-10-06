// Demo handlers for sales capabilities: a pool of healthcare provider groups being sold
// prior-auth automation, with people, signals, an inbox that answers back, a calendar
// and a CRM. Everything lives in module memory and resets when the server restarts.
import { randomBytes } from 'node:crypto';
import { ProviderError } from '../io.js';
import { weekdayName } from '../../playbooks/sales/timezones.js';
import { demoDelay, fake, pick, seeded } from './util.js';

// ── Small helpers ───────────────────────────────────────────────

const DAY = 86_400_000;
const hex = (n) => randomBytes(n).toString('hex');
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const words = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
const firstOf = (name) => String(name ?? '').trim().split(/\s+/)[0] ?? '';
const normDomain = (d) => String(d ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const GENERIC = new Set(['health', 'medical', 'group', 'clinics', 'clinic', 'labs', 'dental', 'orthopedics', 'orthopaedic', 'hospital', 'imaging', 'physicians', 'partners', 'care', 'pediatrics', 'cardiology', 'therapy', 'physical', 'home', 'behavioral', 'urgent', 'network', 'associates', 'centers', 'center', 'institute', 'surgical', 'diagnostics', 'infusion', 'dermatology', 'gastroenterology', 'rehabilitation', 'oncology', 'urology', 'senior', 'sleep', 'hearing', 'wound', 'family', 'medicine', 'women\'s', 'eye', 'spine', '&', 'pain', 'concierge', 'med', 'spa', 'dialysis']);
function shortOf(name) {
  const w = String(name ?? '').split(/\s+/);
  while (w.length > 1 && GENERIC.has(w[w.length - 1].toLowerCase())) w.pop();
  return w.join(' ');
}

const NEWS_HOSTS = {
  Detroit: 'crainsdetroit.com', Minneapolis: 'startribune.com', Columbus: 'dispatch.com', Austin: 'bizjournals.com/austin',
  Denver: 'denverpost.com', Charlotte: 'bizjournals.com/charlotte', Portland: 'oregonlive.com', Norfolk: 'pilotonline.com',
  Fresno: 'fresnobee.com', Boise: 'idahostatesman.com', Phoenix: 'azcentral.com', Tampa: 'tampabay.com', Nashville: 'tennessean.com',
  Raleigh: 'newsobserver.com', Chicago: 'chicagobusiness.com', 'San Diego': 'sandiegouniontribune.com', 'Salt Lake City': 'sltrib.com',
  Louisville: 'courier-journal.com', 'Kansas City': 'kansascity.com', Scottsdale: 'azcentral.com', Baltimore: 'baltimoresun.com',
  Omaha: 'omaha.com', Atlanta: 'ajc.com', Durham: 'newsobserver.com', Houston: 'houstonchronicle.com', Albuquerque: 'abqjournal.com',
  Seattle: 'seattletimes.com', Pittsburgh: 'post-gazette.com', Harrisburg: 'pennlive.com', Boston: 'bostonglobe.com', Orlando: 'orlandosentinel.com',
  'St. Louis': 'stltoday.com', Jacksonville: 'jacksonville.com', Dallas: 'dallasnews.com', Sacramento: 'sacbee.com', Milwaukee: 'jsonline.com',
  Anchorage: 'adn.com', Miami: 'miamiherald.com', 'Los Angeles': 'latimes.com', Indianapolis: 'indystar.com', Cleveland: 'cleveland.com',
  Cincinnati: 'cincinnati.com',
};
const newsHost = (co) => NEWS_HOSTS[co.city] ?? `bizjournals.com/${slug(co.city)}`;

// ── The pool ────────────────────────────────────────────────────
// fit: how well each company scores (strong 88-96, mid 72-90, weak under 70).
// signals: what research turns up; `days` is how long ago it happened.

const COMPANIES = [
  {
    name: 'Acme Health', domain: 'acmehealth.org', industry: 'Hospital & health system', employees: 1200, city: 'Detroit', state: 'MI',
    revenue: '$310M', tech: ['Epic', 'Waystar'], fit: 'strong', about: 'three hospitals and 22 outpatient sites',
    workflow: 'Billing runs on Epic with Waystar for claims; prior authorizations are still worked by hand by a central team of about 30.',
    signals: [
      { kind: 'expansion', days: 49, what: 'the Dearborn ambulatory surgery center', short: 'Dearborn surgery center', place: 'Dearborn', detail: ', 6 ORs' },
      { kind: 'hiring', days: 6, roles: 14, pa: 6 },
      { kind: 'exec', days: 216, person: 'Dana Whitfield', role: 'VP Revenue Cycle', from: 'Henry Ford Health' },
      { kind: 'quote', days: 236, doc: 'Q4 report', quote: 'authorization delays', claim: 'as a top cause of denials' },
      { kind: 'tech', days: 640, tool: 'Waystar' },
    ],
    people: [
      { name: 'Dana Whitfield', title: 'VP Revenue Cycle', email: 'dana.whitfield@acmehealth.org', status: 'verified' },
      { name: 'Kevin Osei', title: 'Director, Patient Access', email: 'kosei@acmehealth.org', status: 'likely' },
      { name: 'Laura Petrov', title: 'CFO', email: 'l.petrov@acmehealth.org', status: 'invalid' },
    ],
    summary: 'Acme Health is a 1,200-person health system in Detroit with three hospitals and 22 outpatient sites. It opened an ambulatory surgery center in Dearborn in {month:expansion} and is hiring heavily in revenue cycle. Billing runs on Epic with Waystar for claims; prior authorizations are still worked by hand by a central team of about 30.',
    whyNow: 'New surgical volume from Dearborn plus 14 open revenue-cycle roles. A new VP Revenue Cycle started in {month:exec} and is likely building her plan for {nextYear}.',
    pains: ['Prior auths worked by hand by a team of ~30', 'Denial rate up after the Dearborn volume', 'Hiring can’t keep up: 14 roles open for 60+ days'],
    angles: ['Growth outpacing the rev-cycle team', 'New VP planning {nextYear} budget', 'Authorization delays named in the Q4 report'],
  },
  {
    name: 'Northwind Medical Group', domain: 'northwindmg.com', industry: 'Physician group', employees: 3100, city: 'Minneapolis', state: 'MN',
    revenue: '$540M', tech: ['Epic', 'Availity'], fit: 'strong', about: '140 physicians across 31 clinics',
    workflow: 'Prior auths are split between clinic staff and a central team, and turnaround slipped after the Epic upgrade.',
    signals: [
      { kind: 'ehr', days: 52, system: 'Epic', event: 'finished its Epic upgrade', area: 'Prior auths' },
      { kind: 'hiring', days: 20, roles: 9, pa: 4 },
    ],
    people: [{ name: 'Priya Natarajan', title: 'VP Revenue Cycle', email: 'pnatarajan@northwindmg.com', status: 'verified' }],
  },
  {
    name: 'Halcyon Labs', domain: 'halcyonlabs.com', industry: 'Diagnostics lab', employees: 640, city: 'Columbus', state: 'OH',
    revenue: '$95M', tech: ['Epic Beaker', 'Waystar'], fit: 'strong', about: 'two reference labs and 40 patient service centers',
    workflow: 'Orders that need prior auth are checked by a small billing team before samples run.',
    signals: [
      { kind: 'ehr', days: 22, system: 'Epic Beaker', systemShort: 'Epic', area: 'Lab orders' },
      { kind: 'hiring', days: 12, roles: 3, team: 'billing' },
    ],
    people: [{ name: 'Sam Okafor', title: 'Director of Lab Operations', email: 'sokafor@halcyonlabs.com', status: 'verified' }],
  },
  {
    name: 'Lakeshore Physicians', domain: 'lakeshorephysicians.com', industry: 'Physician group', employees: 1800, city: 'Chicago', state: 'IL',
    revenue: '$290M', tech: ['Epic'], fit: 'strong', customer: true, about: '180 physicians in 24 clinics',
    signals: [{ kind: 'hiring', days: 30, roles: 4 }],
  },
  {
    name: 'Brightline Dental', domain: 'brightlinedental.com', industry: 'Dental group', employees: 520, city: 'Austin', state: 'TX',
    revenue: '$70M', tech: ['Dentrix', 'Vyne'], fit: 'strong', about: '9 locations across Central Texas',
    workflow: 'Front-desk staff at each office handle pre-authorizations and claim follow-up for dental plans.',
    subject: 'Claim follow-up at Brightline',
    signals: [
      { kind: 'acquisition', days: 70, count: 2, region: 'Round Rock and Georgetown', unit: 'offices' },
      { kind: 'hiring', days: 15, roles: 5, team: 'billing and front-desk' },
    ],
    people: [{ name: 'Marcus Lee', title: 'Practice Owner', email: 'marcus@brightlinedental.com', status: 'verified' }],
  },
  {
    name: 'Corvid Orthopedics', domain: 'corvidortho.com', industry: 'Specialty practice', employees: 870, city: 'Denver', state: 'CO',
    revenue: '$160M', tech: ['athenahealth', 'Waystar'], fit: 'strong', about: '38 surgeons and 4 surgery centers',
    workflow: 'Imaging and surgery auths are worked by schedulers, who also chase payers by phone.',
    signals: [
      { kind: 'policy', days: 35, payer: 'UnitedHealthcare', service: 'outpatient MRI and CT' },
      { kind: 'expansion', days: 80, what: 'a new surgery center in Littleton', short: 'Littleton surgery center', place: 'Littleton' },
    ],
    people: [{ name: 'Lena Brandt', title: 'Head of RevOps', email: 'lbrandt@corvidortho.com', status: 'verified' }],
  },
  {
    name: 'Pinecrest Clinics', domain: 'pinecrestclinics.com', industry: 'Multi-specialty clinics', employees: 2300, city: 'Charlotte', state: 'NC',
    revenue: '$380M', tech: ['NextGen', 'Change Healthcare'], fit: 'strong', about: '26 clinics across the Carolinas',
    workflow: 'A shared-services team of about 20 handles prior auths for every specialty.',
    signals: [
      { kind: 'denials', days: 75, doc: 'Q2 board update', quote: 'denial rate above target' },
      { kind: 'hiring', days: 18, roles: 8, pa: 3 },
    ],
    people: [
      { name: 'Ravi Menon', title: 'VP Finance', email: 'ravi.menon@pinecrestclinics.com', status: 'verified' },
      { name: 'Tom Alvarez', title: 'COO', email: 'tom.alvarez@pinecrestclinics.com', status: 'verified' },
    ],
  },
  {
    name: 'Juniper Home Health', domain: 'juniperhh.com', industry: 'Home health', employees: 1450, city: 'Portland', state: 'OR',
    revenue: '$210M', tech: ['HomeCare HomeBase', 'Availity'], fit: 'strong', about: 'home health and hospice teams in 14 counties',
    workflow: 'Intake coordinators request an auth for every Medicare Advantage admission.',
    signals: [
      { kind: 'payer', days: 40, payer: 'Medicare Advantage', from: 31, to: 44 },
      { kind: 'hiring', days: 9, roles: 6, team: 'intake' },
    ],
    people: [{ name: 'Grace Liu', title: 'CFO', email: 'gliu@juniperhh.com', status: 'verified' }],
  },
  {
    name: 'Tidewater Imaging', domain: 'tidewaterimaging.com', industry: 'Imaging centers', employees: 730, city: 'Norfolk', state: 'VA',
    revenue: '$120M', tech: ['Merge RIS', 'Waystar'], fit: 'strong', about: '12 outpatient imaging centers',
    workflow: 'Schedulers request imaging auths by portal and fax before booking studies.',
    signals: [
      { kind: 'policy', days: 28, payer: 'Anthem', service: 'advanced imaging' },
      { kind: 'expansion', days: 95, what: 'two new MRI sites in Chesapeake', short: 'Chesapeake MRI sites', place: 'Chesapeake' },
    ],
    people: [{ name: 'Helen Park', title: 'Director of Patient Access', email: 'hpark@tidewaterimaging.com', status: 'verified' }],
  },
  {
    name: 'Mercer Valley Hospital', domain: 'mercervalley.org', industry: 'Community hospital', employees: 980, city: 'Fresno', state: 'CA',
    revenue: '$150M', tech: ['Meditech'], fit: 'mid', about: 'a 180-bed hospital and 6 clinics',
    workflow: 'Utilization review and prior auth sit with the case management team.',
    signals: [{ kind: 'quote', days: 110, doc: 'community health report', quote: 'staffing shortages in revenue cycle' }],
    secondPass: [{ kind: 'hiring', days: 10, roles: 4, pa: 2 }],
    people: [{ name: 'Derek Shaw', title: 'Director of Revenue Cycle', email: 'dshaw@mercervalley.org', status: 'verified' }],
  },
  {
    name: 'Lumen Physical Therapy', domain: 'lumenpt.com', industry: 'PT clinics', employees: 650, city: 'Boise', state: 'ID',
    revenue: '$60M', tech: ['WebPT'], fit: 'mid', about: '45 outpatient clinics in Idaho and Utah',
    workflow: 'Clinic managers request therapy visit authorizations themselves.',
    signals: [{ kind: 'acquisition', days: 60, count: 5, region: 'the Salt Lake City area', unit: 'clinics' }],
    secondPass: [{ kind: 'hiring', days: 8, roles: 2, team: 'authorization' }],
    people: [{ name: 'Joy Adeyemi', title: 'VP Operations', email: 'jadeyemi@lumenpt.com', status: 'verified' }],
  },
  {
    name: 'Redfern Urgent Care', domain: 'redfernuc.com', industry: 'Urgent care', employees: 1100, city: 'Phoenix', state: 'AZ',
    revenue: '$130M', tech: ['Experity'], fit: 'mid', about: '28 walk-in clinics',
    workflow: 'Most visits need no prior auth; imaging referrals do.',
    signals: [{ kind: 'expansion', days: 45, what: '4 new clinics in the East Valley', short: 'East Valley clinics', place: 'East Valley' }],
  },
  {
    name: 'Kestrel Cardiology', domain: 'kestrelcardio.com', industry: 'Cardiology practice', employees: 340, city: 'Tampa', state: 'FL',
    revenue: '$85M', tech: ['eClinicalWorks'], fit: 'strong', about: '22 cardiologists and a cath lab',
    workflow: 'Nuclear stress test and echo auths are requested by two schedulers.',
    signals: [
      { kind: 'policy', days: 30, payer: 'Florida Blue', service: 'cardiac imaging' },
      { kind: 'hiring', days: 14, roles: 3, team: 'prior-auth' },
    ],
    people: [{ name: 'Carl Weber', title: 'Practice Administrator', email: 'cweber@kestrelcardio.com', status: 'verified' }],
  },
  {
    name: 'Oakridge Behavioral', domain: 'oakridgebh.com', industry: 'Behavioral health', employees: 560, city: 'Nashville', state: 'TN',
    revenue: '$45M', tech: ['SimplePractice'], fit: 'weak', about: 'outpatient therapy in 9 locations',
    workflow: 'Most clients pay out of pocket; few services need prior auth.', weakReason: 'Mostly cash-pay, little prior-auth',
    signals: [{ kind: 'expansion', days: 100, what: 'a new outpatient office in Franklin', short: 'Franklin office', place: 'Franklin' }],
  },
  {
    name: 'Sablewood Pediatrics', domain: 'sablewoodpeds.com', industry: 'Pediatric practice', employees: 410, city: 'Raleigh', state: 'NC',
    revenue: '$55M', tech: ['athenahealth'], fit: 'strong', about: '11 offices around the Triangle',
    workflow: 'Specialty referrals and therapy auths are handled at each office.',
    signals: [
      { kind: 'expansion', days: 55, what: 'a pediatric therapy center in Cary', short: 'Cary therapy center', place: 'Cary' },
      { kind: 'hiring', days: 21, roles: 4, team: 'referral and billing' },
    ],
    people: [
      { name: 'Ana Ruiz', title: 'Director of Revenue Cycle', email: 'aruiz@sablewoodpeds.com', status: 'verified' },
      { name: 'Mike Chen', title: 'Billing Manager', email: 'mchen@sablewoodpeds.com', status: 'verified' },
    ],
  },
  {
    name: 'Bayfront Surgical Partners', domain: 'bayfrontsurgical.com', industry: 'Ambulatory surgery centers', employees: 900, city: 'San Diego', state: 'CA',
    revenue: '$175M', tech: ['HST Pathways', 'Waystar'], fit: 'strong', about: '9 surgery centers',
    workflow: 'Each center has its own auth coordinator, so the process differs by site.',
    signals: [
      { kind: 'expansion', days: 25, what: 'a tenth surgery center in Carlsbad', short: 'Carlsbad center', place: 'Carlsbad' },
      { kind: 'funding', days: 64, investor: 'Welsh Carson' },
    ],
  },
  {
    name: 'Granite Peak Health', domain: 'granitepeakhealth.org', industry: 'Health system', employees: 4200, city: 'Salt Lake City', state: 'UT',
    revenue: '$720M', tech: ['Epic', 'Experian Health'], fit: 'strong', about: 'two hospitals and 35 clinics',
    workflow: 'A central auth team of about 45 covers both hospitals.',
    signals: [
      { kind: 'exec', days: 40, person: 'Rachel Gallagher', role: 'VP Revenue Cycle', from: 'Intermountain Health' },
      { kind: 'quote', days: 70, doc: 'annual report', quote: 'authorization backlogs', claim: 'as a priority for next year' },
    ],
    people: [{ name: 'Rachel Gallagher', title: 'VP Revenue Cycle', email: 'rachel.gallagher@granitepeakhealth.org', status: 'verified' }],
  },
  {
    name: 'Redwood Coast Radiology', domain: 'redwoodcoastrad.com', industry: 'Imaging centers', employees: 290, city: 'Eureka', state: 'CA',
    revenue: '$30M', tech: [], fit: 'mid', about: '5 imaging sites',
    signals: [{ kind: 'policy', days: 90, payer: 'Blue Shield of California', service: 'advanced imaging' }],
  },
  {
    name: 'Cedar Hollow Medical Group', domain: 'cedarhollowmg.com', industry: 'Physician group', employees: 1600, city: 'Louisville', state: 'KY',
    revenue: '$260M', tech: ['Epic'], fit: 'strong', about: '210 providers in 40 practices',
    workflow: 'Practices submit auths themselves, and a central team handles appeals.',
    signals: [
      { kind: 'acquisition', days: 33, count: 6, region: 'southern Indiana' },
      { kind: 'hiring', days: 8, roles: 11, pa: 5 },
    ],
  },
  {
    name: 'Riverbend Oncology', domain: 'riverbendoncology.com', industry: 'Oncology practice', employees: 780, city: 'Kansas City', state: 'MO',
    revenue: '$230M', tech: ['OncoEMR', 'Availity'], fit: 'strong', about: '14 infusion sites',
    workflow: 'Chemo and imaging auths are worked by nurses between patient visits.',
    signals: [
      { kind: 'policy', days: 26, payer: 'Cigna', service: 'oncology drugs' },
      { kind: 'expansion', days: 90, what: 'a radiation center in Overland Park', short: 'Overland Park radiation center', place: 'Overland Park' },
    ],
  },
  {
    name: 'Summit Ridge Dermatology', domain: 'summitridgederm.com', industry: 'Dermatology group', employees: 450, city: 'Scottsdale', state: 'AZ',
    revenue: '$65M', tech: ['ModMed'], fit: 'mid', about: '17 offices',
    workflow: 'Medical assistants handle biologic auths; cosmetic work is cash-pay.',
    signals: [{ kind: 'acquisition', days: 85, count: 3, region: 'Tucson' }],
  },
  {
    name: 'Prairie Wind Health', domain: 'prairiewindhealth.org', industry: 'Rural health network', employees: 2100, city: 'Omaha', state: 'NE',
    revenue: '$310M', tech: ['Cerner', 'Waystar'], fit: 'strong', about: '7 critical-access hospitals',
    workflow: 'Each hospital runs its own auth desk, mostly by fax.',
    signals: [
      { kind: 'grant', days: 45, amount: '$12M', source: 'Nebraska rural health', use: 'billing systems' },
      { kind: 'hiring', days: 11, roles: 7, pa: 3 },
    ],
  },
  {
    name: 'Magnolia Women’s Health', domain: 'magnoliawh.com', industry: 'Women’s health group', employees: 620, city: 'Atlanta', state: 'GA',
    revenue: '$95M', tech: ['athenahealth'], fit: 'strong', about: '19 OB/GYN offices and 3 imaging suites',
    workflow: 'Imaging and fertility auths go through a 6-person central team.',
    signals: [
      { kind: 'expansion', days: 38, what: 'a fertility clinic in Alpharetta', short: 'Alpharetta fertility clinic', place: 'Alpharetta' },
      { kind: 'hiring', days: 17, roles: 4, pa: 2 },
    ],
  },
  {
    name: 'Harborview Dialysis Partners', domain: 'harborviewdialysis.com', industry: 'Dialysis centers', employees: 1300, city: 'Baltimore', state: 'MD',
    revenue: '$190M', tech: ['Epic'], fit: 'mid', about: '24 dialysis centers',
    workflow: 'Most treatments are covered by Medicare; auths are needed mainly for Medicare Advantage plans.',
    signals: [{ kind: 'payer', days: 60, payer: 'Medicare Advantage', from: 38, to: 47 }],
    secondPass: [{ kind: 'hiring', days: 12, roles: 3, team: 'intake' }],
  },
  {
    name: 'Silverline Diagnostics', domain: 'silverlinedx.com', industry: 'Diagnostics lab', employees: 1150, city: 'Durham', state: 'NC',
    revenue: '$160M', tech: ['Orchard', 'Xifin'], fit: 'strong', about: 'molecular and genetic testing for 3,000 clinics',
    workflow: 'Genetic test auths are worked by a team of 18 specialists.',
    signals: [
      { kind: 'policy', days: 31, payer: 'Aetna', service: 'genetic testing' },
      { kind: 'hiring', days: 9, roles: 6, pa: 6 },
    ],
  },
  {
    name: 'Copperfield Orthopaedic Associates', domain: 'copperfieldortho.com', industry: 'Orthopedic group', employees: 1050, city: 'Houston', state: 'TX',
    revenue: '$210M', tech: ['Epic', 'Waystar'], fit: 'strong', about: '52 surgeons and 3 surgery centers',
    workflow: 'Surgery schedulers request auths and track them in spreadsheets.',
    signals: [
      { kind: 'expansion', days: 44, what: 'a sports medicine center in Katy', short: 'Katy sports medicine center', place: 'Katy' },
      { kind: 'quote', days: 70, doc: 'Q2 investor letter', quote: 'prior authorization delays', claim: 'pushing surgeries out' },
    ],
  },
  {
    name: 'Oakmont Medical Spa', domain: 'oakmontmedspa.com', industry: 'Medical aesthetics', employees: 320, city: 'Dallas', state: 'TX',
    revenue: '$25M', tech: [], fit: 'weak', weakReason: 'Cash-pay aesthetics, almost no prior auth', about: '6 locations',
    workflow: 'Services are self-pay.',
    signals: [{ kind: 'expansion', days: 60, what: 'a new location in Plano', short: 'Plano location', place: 'Plano' }],
  },
  {
    name: 'Blue Mesa Health Partners', domain: 'bluemesahealth.com', industry: 'Physician group', employees: 2700, city: 'Albuquerque', state: 'NM',
    revenue: '$400M', tech: ['eClinicalWorks', 'Availity'], fit: 'strong', about: '300 providers across New Mexico',
    workflow: 'Auths are requested by each practice, with no central team.',
    signals: [
      { kind: 'payer', days: 50, payer: 'Medicaid managed care', from: 22, to: 35 },
      { kind: 'exec', days: 60, person: 'Andre Morrison', role: 'Chief Revenue Officer', from: 'Presbyterian Healthcare' },
    ],
    people: [{ name: 'Andre Morrison', title: 'Chief Revenue Officer', email: 'amorrison@bluemesahealth.com', status: 'verified' }],
  },
  {
    name: 'Evergreen Infusion', domain: 'evergreeninfusion.com', industry: 'Infusion centers', employees: 480, city: 'Seattle', state: 'WA',
    revenue: '$90M', tech: ['WellSky'], fit: 'strong', about: '16 infusion suites',
    workflow: 'Pharmacists and nurses split specialty-drug auths between them.',
    signals: [
      { kind: 'policy', days: 20, payer: 'Premera', service: 'specialty infusions' },
      { kind: 'expansion', days: 30, what: 'four infusion suites in Spokane', short: 'Spokane suites', place: 'Spokane' },
    ],
  },
  {
    name: 'Northgate Gastroenterology', domain: 'northgategi.com', industry: 'GI practice', employees: 530, city: 'Pittsburgh', state: 'PA',
    revenue: '$100M', tech: ['gMed'], fit: 'strong', about: '40 gastroenterologists and 5 endoscopy centers',
    workflow: 'Procedure auths are requested by schedulers at each endoscopy center.',
    signals: [
      { kind: 'hiring', days: 13, roles: 5, pa: 3 },
      { kind: 'quote', days: 65, doc: 'patient newsletter', quote: 'longer waits for procedure approvals', claim: '' },
    ],
  },
  {
    name: 'Allegheny Spine & Pain', domain: 'alleghenyspine.com', industry: 'Pain management', employees: 390, city: 'Harrisburg', state: 'PA',
    revenue: '$50M', tech: ['ModMed'], fit: 'mid', about: '8 clinics',
    signals: [{ kind: 'policy', days: 100, payer: 'Highmark', service: 'spinal injections' }],
  },
  {
    name: 'Lighthouse Pediatrics Network', domain: 'lighthousepeds.org', industry: 'Pediatric network', employees: 1400, city: 'Boston', state: 'MA',
    revenue: '$180M', tech: ['Epic'], fit: 'mid', about: '30 practices',
    signals: [{ kind: 'quote', days: 95, doc: 'annual report', quote: 'referral authorization delays', claim: '' }],
    secondPass: [{ kind: 'hiring', days: 6, roles: 3, team: 'referral' }],
  },
  {
    name: 'Sunstone Senior Care', domain: 'sunstoneseniorcare.com', industry: 'Home health & hospice', employees: 2400, city: 'Orlando', state: 'FL',
    revenue: '$280M', tech: ['WellSky', 'Availity'], fit: 'strong', about: 'home health and hospice across Central Florida',
    workflow: 'Intake nurses request auths for each new admission.',
    signals: [
      { kind: 'payer', days: 42, payer: 'Medicare Advantage', from: 35, to: 52 },
      { kind: 'acquisition', days: 88, count: 3, region: 'the Tampa Bay area', unit: 'agencies' },
    ],
  },
  {
    name: 'Westbrook Eye Institute', domain: 'westbrookeye.com', industry: 'Ophthalmology group', employees: 610, city: 'St. Louis', state: 'MO',
    revenue: '$110M', tech: ['NextGen'], fit: 'strong', about: '25 ophthalmologists and 2 surgery centers',
    workflow: 'Retina injection auths are worked by technicians between clinic sessions.',
    signals: [
      { kind: 'policy', days: 24, payer: 'UnitedHealthcare', service: 'retina injections' },
      { kind: 'expansion', days: 70, what: 'a retina center in Chesterfield', short: 'Chesterfield retina center', place: 'Chesterfield' },
    ],
  },
  {
    name: 'Clearwater Sleep Centers', domain: 'clearwatersleep.com', industry: 'Sleep medicine', employees: 330, city: 'Jacksonville', state: 'FL',
    revenue: '$40M', tech: [], fit: 'mid', about: '7 sleep labs',
    signals: [{ kind: 'policy', days: 115, payer: 'Florida Blue', service: 'in-lab sleep studies' }],
  },
  {
    name: 'Ironwood Rehabilitation', domain: 'ironwoodrehab.com', industry: 'Rehab hospital', employees: 1700, city: 'Dallas', state: 'TX',
    revenue: '$240M', tech: ['Meditech', 'Waystar'], fit: 'strong', about: '4 inpatient rehab hospitals',
    workflow: 'Admissions liaisons wait on payer approval before every transfer.',
    signals: [
      { kind: 'expansion', days: 36, what: 'a 40-bed rehab hospital in Frisco', short: 'Frisco hospital', place: 'Frisco' },
      { kind: 'hiring', days: 7, roles: 10, pa: 4 },
    ],
  },
  {
    name: 'Valley Oak Medical Group', domain: 'valleyoakmg.com', industry: 'Physician group', employees: 1900, city: 'Sacramento', state: 'CA',
    revenue: '$300M', tech: ['Epic'], fit: 'strong', about: '260 providers in 33 clinics',
    workflow: 'Referral auths are worked in a shared Epic work queue.',
    signals: [
      { kind: 'ehr', days: 40, system: 'Epic', event: 'moved its referral work queues into Epic', area: 'Referral auths' },
      { kind: 'denials', days: 85, doc: 'Q2 update', quote: 'denials trending up' },
    ],
  },
  {
    name: 'Northshore Behavioral Health', domain: 'northshorebh.org', industry: 'Behavioral health', employees: 820, city: 'Milwaukee', state: 'WI',
    revenue: '$70M', tech: [], fit: 'mid', about: 'outpatient and residential programs in 12 locations',
    signals: [{ kind: 'payer', days: 75, payer: 'Medicaid managed care', from: 40, to: 51 }],
  },
  {
    name: 'Glacier Family Medicine', domain: 'glacierfm.com', industry: 'Family medicine', employees: 360, city: 'Anchorage', state: 'AK',
    revenue: '$35M', tech: [], fit: 'weak', weakReason: 'Small group with low auth volume', about: '6 clinics',
    signals: [{ kind: 'expansion', days: 110, what: 'a clinic in Wasilla', short: 'Wasilla clinic', place: 'Wasilla' }],
  },
  {
    name: 'Radiant Med Spa Group', domain: 'radiantmedspa.com', industry: 'Medical aesthetics', employees: 420, city: 'Miami', state: 'FL',
    revenue: '$40M', tech: [], fit: 'weak', weakReason: 'Cash-pay aesthetics, almost no prior auth', about: '11 locations',
    workflow: 'Services are self-pay.',
    signals: [{ kind: 'expansion', days: 40, what: 'three new locations in Broward County', short: 'Broward locations', place: 'Broward County' }],
  },
  {
    name: 'Pacific Crest Concierge Medicine', domain: 'pacificcrestmd.com', industry: 'Concierge practice', employees: 310, city: 'Los Angeles', state: 'CA',
    revenue: '$50M', tech: [], fit: 'weak', weakReason: 'Membership model, few insurance claims', about: '4 offices',
    signals: [{ kind: 'funding', days: 90, investor: 'a family office' }],
  },
  {
    name: 'Hawthorne Hearing Centers', domain: 'hawthornehearing.com', industry: 'Audiology', employees: 380, city: 'Indianapolis', state: 'IN',
    revenue: '$30M', tech: [], fit: 'weak', weakReason: 'Hearing aids are mostly self-pay', about: '20 clinics',
    signals: [{ kind: 'acquisition', days: 50, count: 4, region: 'central Ohio', unit: 'clinics' }],
  },
  {
    name: 'Tri-County Urology', domain: 'tricountyurology.com', industry: 'Urology group', employees: 440, city: 'Cleveland', state: 'OH',
    revenue: '$75M', tech: ['NextGen'], fit: 'strong', about: '28 urologists and an imaging center',
    workflow: 'Two coordinators handle every imaging and drug auth.',
    signals: [
      { kind: 'policy', days: 27, payer: 'Medical Mutual', service: 'prostate imaging' },
      { kind: 'hiring', days: 16, roles: 3, pa: 2 },
    ],
  },
  {
    name: 'Keystone Wound Care', domain: 'keystonewound.com', industry: 'Wound care', employees: 520, city: 'Cincinnati', state: 'OH',
    revenue: '$45M', tech: [], fit: 'mid', about: '15 wound clinics',
    signals: [{ kind: 'policy', days: 105, payer: 'Medicare', service: 'skin substitutes' }],
  },
];

const BY_DOMAIN = new Map(COMPANIES.map((c) => [c.domain, c]));

// Companies we were not seeded with (CSV imports) get a believable profile from their domain.
const synthetic = new Map();
const CITIES = [['Columbus', 'OH'], ['Charlotte', 'NC'], ['Denver', 'CO'], ['Nashville', 'TN'], ['Phoenix', 'AZ'], ['Richmond', 'VA'], ['Madison', 'WI'], ['Tulsa', 'OK']];
function profileFor(account = {}) {
  const domain = normDomain(account.domain);
  if (BY_DOMAIN.has(domain)) return BY_DOMAIN.get(domain);
  if (synthetic.has(domain)) return synthetic.get(domain);
  const r = seeded(`${domain}:profile`);
  const [locCity, locState] = String(account.location ?? '').split(',').map((s) => s.trim());
  const [city, state] = locCity ? [locCity, locState || ''] : pick(r, CITIES);
  const payer = pick(r, ['UnitedHealthcare', 'Aetna', 'Cigna', 'Humana']);
  const service = pick(r, ['outpatient imaging', 'specialty drugs', 'outpatient surgery']);
  const options = [
    { kind: 'hiring', days: 5 + Math.floor(r() * 30), roles: 3 + Math.floor(r() * 10), pa: 1 + Math.floor(r() * 3) },
    { kind: 'policy', days: 10 + Math.floor(r() * 50), payer, service },
    { kind: 'payer', days: 20 + Math.floor(r() * 60), payer: 'Medicare Advantage', from: 25 + Math.floor(r() * 10), to: 38 + Math.floor(r() * 10) },
    { kind: 'denials', days: 30 + Math.floor(r() * 60), doc: 'latest annual report', quote: 'rising claim denials' },
  ];
  const first = options.splice(Math.floor(r() * options.length), 1)[0];
  const second = options[Math.floor(r() * options.length)];
  const roll = r();
  const co = {
    name: account.name || shortOf(domain.split('.')[0]),
    domain,
    industry: account.industry || 'Healthcare provider',
    employees: Number(account.employees) || 400 + Math.floor(r() * 2000),
    city,
    state,
    revenue: null,
    tech: [],
    fit: roll < 0.6 ? 'strong' : roll < 0.9 ? 'mid' : 'weak',
    weakReason: 'Low prior-auth volume for their service mix',
    signals: [first, second],
  };
  synthetic.set(domain, co);
  return co;
}

const location = (co) => [co.city, co.state].filter(Boolean).join(', ');
const industryNoun = (co) => (/^[A-Z]{2}/.test(co.industry) ? co.industry : co.industry[0].toLowerCase() + co.industry.slice(1));

// ── Signals ─────────────────────────────────────────────────────

function signalDate(days) {
  const d = new Date(Date.now() - days * DAY);
  return { date: d.toISOString().slice(0, 10), month: MONTHS[d.getMonth()], year: d.getFullYear(), iso: d.toISOString() };
}

const KINDS = {
  expansion: (co, s, d, short) => ({
    type: 'Expansion',
    title: `Opened ${s.what}${s.detail ?? ''}.`,
    headline: `${co.name} opens ${s.what.replace(/^(a|an|the) /, '')}`,
    url: `https://www.${newsHost(co)}/health-care/${slug(co.name)}-${slug(s.place)}-opening`,
    sentence: `It opened ${s.what} in ${d.month}.`,
    subject: `Prior-auth volume after the ${s.place} opening`,
    opener: `Congrats on opening the ${s.short} in ${d.month}.`,
    bridge: 'New sites usually add prior-auth volume faster than the team that works it.',
    angleText: 'Growth is outpacing the revenue-cycle team.',
    briefAngle: 'Growth outpacing the rev-cycle team',
    pain: `More auth volume from the ${s.place} opening`,
    why: `New volume from ${s.place}`,
    noun: 'an expansion',
  }),
  hiring: (co, s, d, short) => {
    const team = s.team ?? 'revenue-cycle';
    return {
      type: 'Hiring',
      title: s.pa ? `${s.roles} open ${team} roles, ${s.pa} of them prior-auth specialists.` : `Posted ${s.roles} ${team} roles in the last 30 days.`,
      headline: `Careers at ${co.name}: ${cap(team)}`,
      url: `https://${co.domain}/careers`,
      sentence: `It has ${s.roles} open ${team} roles${s.pa ? `, ${s.pa} of them for prior-auth specialists` : ''}.`,
      subject: `${s.roles} open ${team} roles at ${short}`,
      opener: `Noticed ${s.roles} ${team} roles open on your careers page.`,
      bridge: `With ${s.roles} ${team} roles open on your careers page, I’m guessing prior-auth volume is growing faster than the team.`,
      angleText: 'Hiring is not keeping up with prior-auth volume.',
      briefAngle: 'Hiring is not keeping up with the work',
      pain: `Hiring can’t keep up: ${s.roles} roles open`,
      why: `${s.roles} open ${team} roles`,
      noun: 'a hiring spike',
    };
  },
  ehr: (co, s, d, short) => {
    const event = s.event ?? `went live on ${s.system}`;
    const sys = s.systemShort ?? s.system;
    return {
      type: 'Tech install',
      title: `${cap(event)} in ${d.month}.`,
      headline: `${co.name} ${event}`,
      url: `https://${co.domain}/news/${slug(s.system)}-go-live`,
      sentence: `It ${event} in ${d.month}.`,
      subject: `${s.area ?? 'Prior auths'} after the ${sys} go-live`,
      opener: `Saw ${short} ${event} in ${d.month}.`,
      bridge: 'Most groups we talk to see prior-auth rejections spike for a quarter after a switch like that.',
      angleText: 'A system migration usually brings a short-term spike in denials.',
      briefAngle: `Denials usually spike for a quarter after a ${sys} go-live`,
      pain: `Prior-auth rejections up during the ${sys} transition`,
      why: `The ${sys} go-live in ${d.month}`,
      noun: 'a system go-live',
    };
  },
  payer: (co, s, d, short) => ({
    type: 'News',
    title: `${s.payer} share up from ${s.from}% to ${s.to}% year over year.`,
    headline: `${co.name} ${d.year} annual report`,
    url: `https://${co.domain}/annual-report-${d.year}`,
    sentence: `Its ${s.payer} share rose from ${s.from}% to ${s.to}% this year.`,
    subject: `${s.payer} auths at ${short}`,
    opener: `${short}’s ${s.payer} share went from ${s.from}% to ${s.to}% this year, based on your annual report.`,
    bridge: 'That usually means a lot more prior-auth work.',
    angleText: `Payer mix shifted toward ${s.payer}, which drives prior-auth volume.`,
    briefAngle: `Payer mix shifting toward ${s.payer}`,
    pain: `More ${s.payer} patients, more auths per visit`,
    why: `${s.payer} share up to ${s.to}%`,
    noun: 'a payer-mix shift',
  }),
  denials: (co, s, d, short) => ({
    type: 'News',
    title: `${s.doc} mentions “${s.quote}.”`,
    headline: `${co.name} ${s.doc}`,
    url: `https://${co.domain}/investors`,
    sentence: `Its ${s.doc} mentions a “${s.quote}.”`,
    subject: `Denied claims at ${short}`,
    opener: `Your ${s.doc} called out a “${s.quote}.”`,
    bridge: 'In groups like yours, late or missing prior auths are usually behind a big share of those denials.',
    angleText: 'Denials are already a named problem in their own reporting.',
    briefAngle: 'Denials named as a problem in their own reporting',
    pain: cap(s.quote),
    why: `Leadership is already talking about the ${s.quote}`,
    noun: 'a denial problem in their own reporting',
  }),
  exec: (co, s, d) => ({
    type: 'Exec change',
    title: `${s.person} named ${s.role}${s.from ? `, joining from ${s.from}` : ''}.`,
    headline: `${s.person} joins ${co.name} as ${s.role}`,
    url: `https://www.linkedin.com/in/${slug(s.person)}`,
    sentence: `${s.person} joined as ${s.role} in ${d.month}${s.from ? `, from ${s.from}` : ''}.`,
    subject: `Your first year as ${s.role}`,
    opener: `Saw that ${s.person} joined as ${s.role} in ${d.month}.`,
    bridge: 'New leaders usually get one budget cycle to fix the backlog they inherit.',
    angleText: `A new ${s.role} is building next year’s plan.`,
    briefAngle: `New ${s.role} planning ${new Date().getFullYear() + 1} budget`,
    pain: null,
    why: `A new ${s.role} started in ${d.month}`,
    noun: 'a leadership change',
    person: s.person,
  }),
  quote: (co, s, d, short) => ({
    type: 'News',
    title: `${s.doc} cites “${s.quote}”${s.claim ? ` ${s.claim}` : ''}.`.replace(/^./, (c) => c.toUpperCase()),
    headline: `${co.name} ${s.doc}`,
    url: `https://${co.domain}/news`,
    sentence: `Its ${s.doc} cites “${s.quote}”${s.claim ? ` ${s.claim}` : ''}.`,
    subject: `${cap(s.quote)} at ${short}`,
    opener: `Your ${s.doc} named “${s.quote}”${s.claim ? ` ${s.claim}` : ''}.`,
    bridge: 'That is the exact problem we work on.',
    angleText: `${cap(s.quote)} are named in their own ${s.doc}.`,
    briefAngle: `${cap(s.quote)} named in the ${s.doc}`,
    pain: cap(s.quote),
    why: `${cap(s.quote)} named in the ${s.doc}`,
    noun: 'a public mention of the problem',
  }),
  acquisition: (co, s, d, short) => {
    const unit = s.unit ?? 'practices';
    return {
      type: 'Expansion',
      title: `Acquired ${s.count} ${unit} in ${s.region}.`,
      headline: `${co.name} acquires ${s.count} ${unit} in ${s.region}`,
      url: `https://www.${newsHost(co)}/health-care/${slug(co.name)}-acquires-${slug(s.region)}`,
      sentence: `It acquired ${s.count} ${unit} in ${s.region} in ${d.month}.`,
      subject: `Prior auths across ${s.count} new ${unit}`,
      opener: `Congrats on bringing ${s.count} ${unit} in ${s.region} into ${short}.`,
      bridge: 'Integrations like that usually mean several payer workflows running side by side for a while.',
      angleText: `${cap(String(s.count))} acquired ${unit} are still running their own prior-auth workflows.`,
      briefAngle: `Integrating ${s.count} acquired ${unit}`,
      pain: 'Different prior-auth workflows at each acquired site',
      why: `${s.count} ${unit} acquired in ${d.month}`,
      noun: 'an acquisition',
    };
  },
  funding: (co, s, d) => ({
    type: 'Funding',
    title: `Announced a growth investment from ${s.investor}.`,
    headline: `${co.name} announces growth investment from ${s.investor}`,
    url: `https://www.businesswire.com/news/home/${d.date.replace(/-/g, '')}/${slug(co.name)}-growth-investment`,
    sentence: `It announced a growth investment from ${s.investor} in ${d.month}.`,
    subject: 'Scaling the revenue cycle after the new investment',
    opener: `Congrats on the growth investment from ${s.investor}.`,
    bridge: 'Most groups use a raise like that to add sites, and prior-auth work grows with them.',
    angleText: 'New capital usually means new sites, and more prior-auth work.',
    briefAngle: 'New capital to add sites',
    pain: null,
    why: `New investment from ${s.investor}`,
    noun: 'a new investment',
  }),
  grant: (co, s, d) => ({
    type: 'Funding',
    title: `Awarded a ${s.amount} ${s.source} grant to modernize ${s.use}.`,
    headline: `${co.name} wins ${s.amount} ${s.source} grant`,
    url: `https://www.${newsHost(co)}/health-care/${slug(co.name)}-grant`,
    sentence: `It won a ${s.amount} ${s.source} grant in ${d.month} to modernize ${s.use}.`,
    subject: `The ${s.source} grant and prior auth`,
    opener: `Congrats on the ${s.amount} ${s.source} grant.`,
    bridge: 'If any of it goes to the revenue cycle, prior auth is usually where it pays back fastest.',
    angleText: 'New grant money is earmarked for billing systems.',
    briefAngle: 'Grant money earmarked for billing systems',
    pain: 'Fax-based auth desks at each hospital',
    why: `A ${s.amount} grant for ${s.use}`,
    noun: 'new grant money',
  }),
  policy: (co, s, d) => ({
    type: 'News',
    title: `${s.payer} added prior-auth requirements for ${s.service}.`,
    headline: `${s.payer} expands prior authorization rules for ${s.service}`,
    url: `https://www.beckerspayer.com/payer/${slug(s.payer)}-prior-auth-${slug(s.service)}`,
    sentence: `${s.payer}, one of its largest payers, added prior-auth requirements for ${s.service} in ${d.month}.`,
    subject: `New ${s.payer} auth rules for ${s.service}`,
    opener: `${s.payer} added prior-auth requirements for ${s.service} in ${d.month}.`,
    bridge: `For a group with your ${s.service} volume, that is a lot of new paperwork.`,
    angleText: `New ${s.payer} rules hit their core service line.`,
    briefAngle: `New ${s.payer} prior-auth rules for ${s.service}`,
    pain: `New ${s.payer} auth rules for ${s.service}`,
    why: `${s.payer} added auth rules for ${s.service} in ${d.month}`,
    noun: 'a payer rule change',
  }),
  tech: (co, s) => ({
    type: 'Tech install',
    title: `Moved claims to ${s.tool}.`,
    headline: `${co.name} technology profile`,
    url: `https://builtwith.com/${co.domain}`,
    sentence: `Claims run through ${s.tool}.`,
  }),
};

/** Rendered signals for a company, newest-relevant first. */
function signalsOf(co, { secondPass = false } = {}) {
  const short = shortOf(co.name);
  const list = [...(co.signals ?? []), ...(secondPass ? co.secondPass ?? [] : [])];
  return list.map((s) => {
    const d = signalDate(s.days);
    return { kind: s.kind, days: s.days, date: d.date, publishedAt: d.iso, month: d.month, ...KINDS[s.kind](co, s, d, short) };
  });
}

function fillTemplate(text, sigs) {
  return String(text)
    .replace(/\{month:(\w+)\}/g, (_, kind) => sigs.find((s) => s.kind === kind)?.month ?? '')
    .replace(/\{nextYear\}/g, String(new Date().getFullYear() + 1));
}

// ── People ──────────────────────────────────────────────────────

const FIRST = ['Rachel', 'Andre', 'Monica', 'Jason', 'Teresa', 'Omar', 'Natalie', 'Brian', 'Keisha', 'Victor', 'Elena', 'Chris', 'Fatima', 'Greg', 'Hannah', 'Luis', 'Megan', 'Darnell', 'Sofia', 'Patrick', 'Yvonne', 'Ethan', 'Nadia', 'Raymond', 'Julia', 'Hector', 'Alicia', 'Wesley', 'Tanya', 'Isaac', 'Bridget', 'Mateo', 'Colleen', 'Arjun', 'Lauren', 'Devon'];
const LAST = ['Gallagher', 'Brooks', 'Delgado', 'Kowalski', 'Hughes', 'Nguyen', 'Patel', 'Morrison', 'Sullivan', 'Ramirez', 'Fischer', 'Coleman', 'Haddad', 'Bennett', 'Yamamoto', 'Okonkwo', 'Lindqvist', 'Mercer', 'Castillo', 'Dubois', 'Reddy', 'Novak', 'Abbott', 'Harlan', 'Tran', 'Iverson', 'Sato', 'Fitzgerald', 'Moreno', 'Kaplan', 'Ellison', 'Pruitt', 'Vance', 'Quinn', 'Hollis', 'Barrett'];
const TITLE_POOL = ['VP Revenue Cycle', 'Director of Patient Access', 'CFO', 'Director of Revenue Cycle', 'COO', 'Head of RevOps', 'VP Finance', 'Director of Billing', 'Revenue Cycle Manager', 'Practice Administrator'];
// Companies with a named lead keep that person as the obvious first contact.
const TOP_TITLES = new Set(['VP Revenue Cycle', 'Director of Revenue Cycle', 'Head of RevOps']);
const PATTERNS = ['first.last', 'flast', 'first', 'f.last'];

function emailFor(pattern, first, last, domain) {
  const f = first.toLowerCase().replace(/[^a-z]/g, '');
  const l = last.toLowerCase().replace(/[^a-z]/g, '');
  const local = { 'first.last': `${f}.${l}`, flast: `${f[0]}${l}`, first: f, 'f.last': `${f[0]}.${l}` }[pattern];
  return `${local}@${domain}`;
}

function seniorityOf(title) {
  const t = title.toLowerCase();
  if (/\bc[efor]o\b|chief|owner/.test(t)) return 'C-suite';
  if (/\bvp\b|vice president|head of/.test(t)) return 'VP';
  if (/director/.test(t)) return 'Director';
  return 'Manager';
}

const peopleCache = new Map();
function peopleFor(co) {
  if (peopleCache.has(co.domain)) return peopleCache.get(co.domain);
  const r = seeded(`${co.domain}:people`);
  const pattern = pick(r, PATTERNS);
  const people = (co.people ?? []).map((p) => ({ ...p, designed: true }));
  const titles = new Set(people.map((p) => p.title));
  const names = new Set(people.map((p) => p.name));
  for (let guard = 0; people.length < 5 && guard < 50; guard++) {
    const first = pick(r, FIRST);
    const last = pick(r, LAST);
    const name = `${first} ${last}`;
    if (names.has(name)) continue;
    const open = TITLE_POOL.filter((t) => !titles.has(t) && !(co.people?.length && TOP_TITLES.has(t)));
    const title = open[Math.floor(r() * Math.min(open.length, 4))];
    names.add(name);
    titles.add(title);
    people.push({ name, title, email: emailFor(pattern, first, last, co.domain), hideEmail: r() < 0.3 });
  }
  const out = people.map((p) => {
    const [first, ...rest] = p.name.split(' ');
    return {
      ...p,
      firstName: first,
      lastName: rest.join(' '),
      linkedin: `https://www.linkedin.com/in/${slug(p.name)}-${slug(co.domain).slice(0, 4)}`,
      location: location(co),
      seniority: seniorityOf(p.title),
      externalId: `per_${seeded(p.email)().toString(16).slice(2, 12)}`,
    };
  });
  peopleCache.set(co.domain, out);
  return out;
}

function personByEmail(email) {
  const domain = String(email ?? '').split('@')[1];
  if (!domain) return null;
  return peopleFor(profileFor({ domain })).find((p) => p.email === email) ?? null;
}

// ── Companies as the data provider returns them ────────────────

function toAccount(co) {
  return {
    name: co.name,
    domain: co.domain,
    industry: co.industry,
    employees: co.employees,
    location: location(co),
    linkedin: `https://www.linkedin.com/company/${slug(co.name)}`,
    revenue: co.revenue ?? null,
    tech: co.tech ?? [],
    description: `${co.name} is a ${industryNoun(co)} based in ${location(co)}${co.about ? ` with ${co.about}` : ''}.`,
    externalId: `org_${seeded(co.domain)().toString(16).slice(2, 14)}`,
    source: 'Sample data',
  };
}

function findCompanyIn(text) {
  const t = String(text ?? '').toLowerCase();
  const known = COMPANIES.find((c) => t.includes(c.domain) || t.includes(c.name.toLowerCase()))
    ?? [...synthetic.values()].find((c) => t.includes(c.domain) || t.includes(c.name.toLowerCase()));
  if (known) return known;
  // An imported company: research queries carry its quoted name and its domain.
  const domain = t.match(/\b((?:[a-z0-9-]+\.)+(?:com|org|net|health|care|io|co|us|clinic))\b/)?.[1];
  if (!domain || domain.startsWith('http')) return null;
  const name = String(text).match(/"([^"]+)"/)?.[1];
  return profileFor({ domain, name });
}

// ── Mail, calendar and CRM state ────────────────────────────────

const mail = { threads: new Map(), inbox: [], sent: [] };
const crm = { companies: new Map(), contacts: new Map(), activities: 0, next: 18834920117 };
for (const co of COMPANIES.filter((c) => c.customer)) {
  crm.companies.set(co.domain, { id: String(crm.next), url: `https://app.hubspot.com/contacts/4412/company/${crm.next}` });
  crm.next += 7919;
}

/** For tests and scripts: what the sample mailbox has seen. */
export function salesDemoState() {
  return { sent: mail.sent.slice(), inbox: mail.inbox.slice(), threads: mail.threads.size };
}

const replyRate = (outboundCount) => {
  const forced = Number(process.env.MILO_DEMO_REPLY_RATE);
  if (process.env.MILO_DEMO_REPLY_RATE !== undefined && Number.isFinite(forced)) return forced;
  return outboundCount === 1 ? 0.45 : 0.3;
};

const INTENT_WEIGHTS = [
  ['interested', 30], ['question', 20], ['referral', 9], ['out_of_office', 10],
  ['not_now', 10], ['not_interested', 8], ['unsubscribe', 5], ['security', 8],
];
function pickIntent(r) {
  const forced = process.env.MILO_DEMO_REPLY_INTENT;
  if (forced && INTENT_WEIGHTS.some(([k]) => k === forced)) return forced;
  const total = INTENT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of INTENT_WEIGHTS) if ((x -= w) < 0) return k;
  return 'interested';
}

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
/** "Thursday at 10:00 AM" from a message that offers times, or null. */
function offeredTime(body, r) {
  const re = /\b(Mon|Tue|Wed|Thu|Fri)[a-z]*\b[^.?\n]{0,24}?(\d{1,2}(?::\d{2})?\s?(?:AM|PM))/gi;
  const found = [...String(body ?? '').matchAll(re)].map((m) => `${DAY_NAMES[m[1].toLowerCase()]} at ${m[2].toUpperCase()}`);
  if (!found.length) return null;
  return found.length > 1 && r() < 0.5 ? found[1] : found[0];
}

function referralFor(thread) {
  const co = profileFor({ domain: thread.domain });
  const other = peopleFor(co).find((p) => p.email !== thread.to && /billing|revenue|patient access|rev ?ops/i.test(p.title))
    ?? peopleFor(co).find((p) => p.email !== thread.to);
  return other ?? { name: 'our billing director', email: `billing@${thread.domain}` };
}

function replyBody(intent, thread, ws, r, extra = {}) {
  const me = firstOf(thread.toName) || 'Thanks';
  const sender = firstOf(ws?.settings?.senderName) || 'there';
  const co = profileFor({ domain: thread.domain });
  switch (intent) {
    case 'interested':
      return pick(r, [
        `Hi ${sender},\n\nTiming is actually good. We are feeling this right now. Could we find 20 minutes next week?\n\n${me}`,
        `Hi ${sender},\n\nThis is on our list for next year. Happy to take a look. What does your calendar look like next week?\n\n${me}`,
        `${sender}, thanks for the note. Yes, worth a conversation. Send me a couple of times.\n\n${me}`,
      ]);
    case 'question':
      return pick(r, [
        `Hi ${sender},\n\nWhat does this cost for a group our size?\n\n${me}`,
        `Hi ${sender},\n\nBefore I loop anyone in: how is this priced? We are ${co.about ?? 'a mid-size group'}.\n\n${me}`,
      ]);
    case 'referral': {
      const ref = referralFor(thread);
      return `Hi ${sender},\n\nNot my area. You should talk to ${ref.name}, ${/billing/i.test(ref.title ?? '') ? 'he runs billing' : 'they own this'}. ${ref.email}\n\n${me}`;
    }
    case 'out_of_office': {
      const back = new Date(Date.now() + 6 * DAY).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return `Thanks for your note. I am out of the office until ${back} with limited access to email. For anything urgent, please contact revenuecycle@${thread.domain}.\n\n${me}`;
    }
    case 'not_now':
      return pick(r, [`Not this quarter. Try us in January.\n\n${me}`, `We are mid-budget cycle. Reach back out in the new year.\n\n${me}`]);
    case 'not_interested':
      return pick(r, [`We built this in-house. Not interested.\n\n${me}`, `Thanks, but we are covered here. Not interested.\n\n${me}`]);
    case 'unsubscribe':
      return 'Please remove me from your list.';
    case 'security':
      return pick(r, [
        `Hi ${sender}, timing is good. Before we take a call, can you send your BAA and SOC 2 report? Our compliance team will ask first.\n\n${me}`,
        `Hi ${sender},\n\nWe have a BAA question before we go further. Who can I send our security questionnaire to?\n\n${me}`,
      ]);
    case 'agree':
      return pick(r, [
        `${extra.time} works. Send the invite to this address.\n\n${me}`,
        `Thanks. ${extra.time} is good.\n\n${me}`,
        `That works for us. Let's do ${extra.time}.\n\n${me}`,
      ]);
    default:
      return `Thanks, ${sender}.\n\n${me}`;
  }
}

function scheduleReply(thread, intent, ws, r, extra = {}) {
  const at = new Date(Date.now() + demoDelay(60_000 + r() * 180_000)).toISOString();
  const lastOut = thread.outboundIds[thread.outboundIds.length - 1];
  thread.inbound.push({ intent, at });
  mail.inbox.push({
    messageId: `<${hex(10)}@${thread.domain}>`,
    threadId: thread.id,
    inReplyTo: lastOut,
    from: thread.to,
    fromName: thread.toName || null,
    to: ws?.settings?.senderEmail ?? '',
    subject: intent === 'out_of_office' ? `Automatic reply: ${thread.subject}` : `Re: ${thread.subject.replace(/^re:\s*/i, '')}`,
    body: replyBody(intent, thread, ws, r, extra),
    at,
  });
}

// Decide whether (and how) the prospect answers what we just sent.
function planReply(thread, body, ws) {
  if (thread.done) return;
  // Seeded by the message too, so each step in a sequence gets its own roll even after a restart.
  const r = seeded(`${thread.to}:${thread.outboundIds.length}:${String(body ?? '').length}`);
  const last = thread.inbound[thread.inbound.length - 1];
  if (!last || last.intent === 'out_of_office') {
    if (r() >= replyRate(thread.outboundIds.length)) return;
    let intent = pickIntent(r);
    if (last && intent === 'out_of_office') intent = 'interested';
    scheduleReply(thread, intent, ws, r);
    return;
  }
  if (['interested', 'question', 'security'].includes(last.intent)) {
    const time = offeredTime(body, r);
    if (time && r() < 0.9) scheduleReply(thread, 'agree', ws, r, { time });
    return;
  }
  // Agreed, referred, declined or unsubscribed: nothing more to say.
  thread.done = true;
}

// ── Model output for llm.complete ───────────────────────────────

function proofParts(line) {
  const m = String(line ?? '').match(/^([^:]+):\s*(.+)$/);
  return m ? { customer: m[1].trim(), result: m[2].trim().replace(/\.$/, '') } : { customer: null, result: String(line ?? '').trim().replace(/\.$/, '') };
}

function proofSentence(line, settings) {
  const { customer, result } = proofParts(line);
  if (!result) return '';
  if (!customer) return `${cap(result)}.`;
  const company = settings.company || 'we';
  const takeOver = String(settings.product ?? '').match(/we take over ([^.]+)/i)?.[1]?.trim();
  let outcome = result.replace(/ from /, ' went from ');
  const [firstWord, ...rest] = outcome.split(' ');
  if (takeOver && takeOver.toLowerCase().includes(firstWord.toLowerCase())) outcome = rest.join(' ');
  return takeOver
    ? `${customer} was in a similar spot last year. ${company} took over their ${takeOver}, and ${outcome}.`
    : `${customer} was in a similar spot last year. With ${company}, their ${outcome}.`;
}

const proofLines = (settings) => String(settings.proofPoints ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const signature = (settings) => String(settings.signature || settings.senderName || '').trim();

function briefFor(input) {
  const account = input.account ?? {};
  const co = profileFor(account);
  const sigs = signalsOf(co, { secondPass: (account.researchCount ?? 0) >= 1 });
  const hooks = sigs.filter((s) => s.opener);
  const size = `${Number(account.employees || co.employees || 0).toLocaleString('en-US')}-person`;
  const summary = co.summary
    ? fillTemplate(co.summary, sigs)
    : [
        `${co.name} is a ${size} ${industryNoun(co)} in ${co.city}${co.about ? ` with ${co.about}` : ''}.`,
        hooks.slice(0, 2).map((s) => s.sentence).join(' '),
        co.workflow ?? 'Prior authorizations are handled largely by hand.',
      ].filter(Boolean).join(' ');
  const whyNow = co.whyNow
    ? fillTemplate(co.whyNow, sigs)
    : co.fit === 'weak'
      ? `${co.weakReason}, so timing matters less than fit.`
      : hooks.length ? `${hooks.slice(0, 2).map((s) => s.why).join(', plus ').replace(/^./, (c) => c.toUpperCase())}.` : '';
  const pains = co.pains
    ? co.pains.map((p) => fillTemplate(p, sigs))
    : [co.weakReason, ...hooks.map((s) => s.pain)].filter(Boolean).slice(0, 3);
  const angles = co.angles
    ? co.angles.map((a) => fillTemplate(a, sigs))
    : [...new Set(hooks.map((s) => s.briefAngle).filter(Boolean))].slice(0, 3);
  const seen = new Set([...(input.results ?? []), ...(input.news ?? []), ...(input.social ?? [])].map((r) => r.url).filter(Boolean));
  const signals = sigs.map(({ type, date, title, url }) => ({ type, date, title, url }));
  const sources = [...new Set([...signals.map((s) => s.url).filter((u) => seen.has(u)), ...seen])].slice(0, 6);
  return { summary, whyNow, pains, angles, signals, sources };
}

const BANDS = {
  strong: { icp: [90, 97], growth: [84, 94], signal: [86, 97] },
  mid: { icp: [78, 88], growth: [70, 84], signal: [64, 80] },
  weak: { icp: [45, 58], growth: [45, 60], signal: [30, 50] },
};

function roleScore(title = '') {
  const t = title.toLowerCase();
  if (/vp,? revenue cycle|vice president.*revenue|chief revenue/.test(t)) return 96;
  if (/head of rev ?ops|director of revenue cycle|revenue cycle director/.test(t)) return 94;
  if (/lab operations|patient access/.test(t)) return /director/.test(t) ? 90 : 86;
  if (/practice owner|practice administrator/.test(t)) return 90;
  if (/billing/.test(t)) return 88;
  if (/\bcfo\b|chief financial|vp,? finance/.test(t)) return 86;
  if (/\bcoo\b|chief operating|vp,? operations/.test(t)) return 82;
  if (/manager/.test(t)) return 80;
  return 72;
}
const qualityScore = (status) => ({ verified: 90, likely: 82, unknown: 68, invalid: 20 })[status] ?? 68;

function leadScoreFor(input) {
  const account = input.account ?? {};
  const co = profileFor(account);
  const rounds = account.researchCount ?? 0;
  // Some strong accounts look thin on the first pass and firm up after a second one.
  const thinFirst = co.fit === 'strong' && seeded(`${co.domain}:thin`)() < 0.15;
  const band = thinFirst && rounds < 2 ? BANDS.mid : BANDS[co.fit];
  const r = seeded(`${co.domain}:score:${rounds}`);
  const between = ([lo, hi]) => Math.round(lo + r() * (hi - lo));
  let icp = between(band.icp);
  let growth = between(band.growth);
  let signal = between(band.signal);
  if (rounds >= 2 && co.secondPass) {
    signal += 8;
    growth += 4;
  }
  const contacts = (input.contacts ?? []).map((c) => {
    const j = seeded(`${c.email ?? c.name}:fit`);
    const named = personByEmail(c.email)?.designed ? 3 : 0;
    return {
      id: c.id,
      role_relevance: clamp(roleScore(c.title) + named + Math.round(j() * 4 - 2)),
      contact_quality: clamp(qualityScore(c.emailStatus) + Math.round(j() * 6 - 3)),
    };
  });
  const weight = (c) => 0.25 * c.role_relevance + 0.1 * c.contact_quality;
  const best = contacts.reduce((a, b) => (weight(b) > weight(a) ? b : a), contacts[0]);
  const bestContact = (input.contacts ?? []).find((c) => c.id === best?.id);
  const fresh = signalsOf(co).filter((s) => s.opener && s.days <= 90).length;
  const name = firstOf(bestContact?.name) || 'The contact';
  let rationale;
  if (co.fit === 'weak') rationale = `${co.weakReason}. Low prior-auth volume, so little for us to fix.`;
  else if (band === BANDS.mid) {
    rationale = rounds < 2
      ? 'Reasonable fit, but the signals are thin or older than 90 days. Worth another research pass before outreach.'
      : 'Still a middling fit after a second pass. Signals are real but not urgent.';
  } else {
    rationale = `Strong fit on size and payer mix. ${name} ${roleScore(bestContact?.title) >= 88 ? 'owns the team that does prior auths' : 'controls the budget'}, and ${fresh >= 2 ? 'both signals are' : 'the main signal is'} under 90 days old.`;
  }
  return {
    scores: { icp_fit: clamp(icp), company_growth: clamp(growth), buying_signal: clamp(signal) },
    contacts,
    bestContactId: best?.id ?? null,
    rationale,
    skipReason: co.fit === 'weak' ? co.weakReason : '',
  };
}

function owns(title) {
  const score = roleScore(title);
  if (score >= 88) return 'owns the team doing the extra work';
  if (/finance|cfo/i.test(title ?? '')) return 'owns the budget';
  return 'runs the operations side';
}

function outreachFor(input) {
  const { account = {}, contact = {}, settings = {}, step = 1, sequenceSteps = 3, previous = [], notes = [], maxWords = 120 } = input;
  const co = profileFor(account);
  const sigs = signalsOf(co, { secondPass: (account.researchCount ?? 0) >= 2 });
  const hooks = sigs.filter((s) => s.opener);
  const primary = hooks[0] ?? { opener: `I have been reading about ${account.name}.`, bridge: '', subject: `Prior auths at ${shortOf(account.name)}`, angleText: 'A general fit for what we do.', noun: 'a general fit' };
  const secondary = hooks.find((s) => s !== primary && s.kind === 'hiring') ?? null;
  const first = contact.firstName || firstOf(contact.name);
  const sig = signature(settings);
  const proofs = proofLines(settings);
  const short = shortOf(account.name);
  const wantsShorter = notes.some((n) => /long|short|wordy|length|brief/i.test(`${n.text} ${(n.tags ?? []).join(' ')}`));

  if (step === 1) {
    const subject = co.subject ?? primary.subject;
    const isSelf = primary.person && primary.person === contact.name;
    const opener = isSelf ? `Congrats on the move to ${short} as ${contact.title}.` : primary.opener;
    const bridge = secondary ? secondary.bridge : primary.bridge;
    const proof = proofs.length ? proofSentence(proofs[0], settings) : `${settings.company || 'We'} help groups like yours take prior auths off the team's plate.`;
    const ask = wantsShorter ? 'Worth a quick call?' : 'Would a 20-minute call next week be useful? I can show what that looked like for a group your size.';
    let lead = `${opener} ${bridge}`.trim();
    let body = `Hi ${first},\n\n${lead}\n\n${proof}\n\n${ask}\n\n${sig}`;
    if (wantsShorter || body.split(/\s+/).length > maxWords + 8) {
      lead = opener;
      body = `Hi ${first},\n\n${lead}\n\n${proof}\n\n${ask}\n\n${sig}`;
    }
    const found = [primary, secondary].filter(Boolean).map((s) => s.noun);
    const angle = `${primary.angleText} Researcher found ${found.join(' and ')}${found.length > 1 ? ' in the same quarter' : ''}, and ${first} ${owns(contact.title)}.`;
    const facts = [primary, secondary, sigs.find((s) => s.kind === 'exec' && s !== primary)]
      .filter((s) => s?.title && s.url)
      .map((s) => ({ text: s.title, src: s.url }));
    return { subject, body, angle, facts };
  }

  const subject = `Re: ${String(previous[0]?.subject ?? co.subject ?? primary.subject).replace(/^re:\s*/i, '')}`;
  if (step < sequenceSteps) {
    const proof = proofs[1] ?? proofs[0] ?? '';
    const { customer, result } = proofParts(proof);
    const number = customer ? `${customer} saw ${result}` : result;
    const body = `Hi ${first},\n\nFollowing up on my note last week. One number that might be useful: ${number}.\n\nWorth 20 minutes?\n\n${sig}`;
    return {
      subject,
      body,
      angle: 'No reply to the first touch. Follow-up leads with a proof point instead of repeating the angle.',
      facts: proof ? [{ text: number, src: 'your proof points' }] : [],
    };
  }
  const customer = proofParts(proofs[0] ?? '').customer ?? 'a group like yours';
  const pain = (primary.pain ?? 'prior-auth volume').replace(/^./, (c) => c.toLowerCase());
  const body = `Hi ${first},\n\nLast note from me. If ${pain} is handled at ${short}, no need to reply. If it is still a bottleneck, I can send a one-page summary of how ${customer} set this up.\n\n${sig}`;
  return { subject, body, angle: 'Last step in the sequence. Short and easy to say no to.', facts: [] };
}

function classifyFor(input) {
  const text = String(input.message?.body ?? '');
  const t = text.toLowerCase();
  let intent = 'interested';
  let escalate = false;
  let reason = null;
  if (/remove me|unsubscribe|stop emailing|take me off/.test(t)) intent = 'unsubscribe';
  else if (/out of (the )?office|auto(matic)?[- ]?reply|out until|limited access to email/.test(t)) intent = 'out_of_office';
  else if (/\bbaa\b|soc ?2|hipaa|security questionnaire|compliance team/.test(t)) {
    intent = /timing is good|interested/.test(t) ? 'interested' : 'question';
    escalate = true;
    reason = 'security question';
  } else if (/not interested|in-house|no thanks|we are covered/.test(t)) intent = 'not_interested';
  else if (/not this quarter|try us in|new year|circle back|not right now|mid-budget/.test(t)) intent = 'not_now';
  else if (/talk to|reach out to|better person|runs billing|loop in|own this/.test(t)) intent = 'referral';
  else if (/cost|price|pricing|priced|how much/.test(t)) {
    intent = 'question';
    reason = 'pricing question';
  }

  let agreedTime = null;
  const slots = input.thread?.offeredSlots ?? [];
  const day = text.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday)\b/i)?.[1];
  if (['interested', 'question'].includes(intent) && day && slots.length && /works|is good|let's do|fine|perfect/i.test(text)) {
    const slot = slots.find((s) => weekdayName(s.start, input.contact?.timezone).toLowerCase() === day.toLowerCase());
    if (slot) {
      agreedTime = slot.start;
      intent = 'interested';
    }
  }
  return { intent, escalate, reason, agreedTime };
}

function timePhrase(slot, tz) {
  const d = new Date(slot.start);
  const day = weekdayName(slot.start, tz);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);
  const zone = (slot.label ?? '').split(' ').pop();
  return `${day} at ${time}${zone && /^[A-Z]{2,4}$/.test(zone) ? ` ${zone}` : ''}`;
}

function replyDraftFor(input) {
  const { contact = {}, account = {}, settings = {}, intent, slots = [], bookingUrl, meeting, thread = {}, message = {} } = input;
  const first = contact.firstName || firstOf(contact.name);
  const sig = signature(settings);
  const tz = contact.timezone;
  const subject = `Re: ${String(thread.subject ?? '').replace(/^re:\s*/i, '')}`;
  const customer = proofParts(proofLines(settings)[0] ?? '').customer;
  const times = slots.length >= 2
    ? `Would ${timePhrase(slots[0], tz)} or ${timePhrase(slots[1], tz)} work?`
    : slots.length === 1
      ? `Does ${timePhrase(slots[0], tz)} work?`
      : bookingUrl
        ? `If it is easier, grab any time that works here: ${bookingUrl}`
        : 'Would a 20-minute call next week work?';

  if (meeting) {
    return {
      subject,
      body: `${first},\n\nSending over the invite for ${meeting.label}.${customer ? ` I will bring the ${customer.split(' ')[0]} numbers.` : ''}\n\n${sig}`,
      angle: `${first} picked a time. SDR checked your calendar and prepared the invite.`,
    };
  }
  const text = String(message.body ?? '');
  if (intent === 'referral') {
    const ref = text.match(/talk to ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/)?.[1] ?? 'them';
    return {
      subject,
      body: `Hi ${first},\n\nThanks for pointing me to ${ref}. Would you be open to a quick intro, or should I reach out directly?\n\n${sig}`,
      angle: `${first} pointed us to ${ref}. SDR thanked them and asked for an introduction.`,
    };
  }
  if (intent === 'question' && /cost|price|pricing|priced|how much/i.test(text)) {
    const range = String(settings.pricingNotes ?? '').match(/between (\$[\d,.]+[kKmM]?) and (\$[\d,.]+[kKmM]?)( a month| per month)?/);
    const pricing = range
      ? `Pricing is per provider per month, and for a group like ${shortOf(account.name)} it usually lands between ${range[1]} and ${range[2]}${range[3] ?? ''}.`
      : settings.pricingNotes ? String(settings.pricingNotes).split('\n')[0] : 'Pricing depends on volume. I can put real numbers together after a short call.';
    return {
      subject,
      body: `Hi ${first},\n\nGood question. ${pricing}\n\nHappy to walk through it on a call. ${times}\n\n${sig}`,
      angle: `${first} asked about pricing. SDR answered with the range from your pricing notes${slots.length ? ' and proposed a time from your calendar' : ''}.`,
    };
  }
  if (intent === 'question') {
    return {
      subject,
      body: `Hi ${first},\n\nGood question. Short answer: ${String(settings.product ?? 'we take this work off your team').split('.')[0].toLowerCase()}. Easier to show than to describe. ${times}\n\n${sig}`,
      angle: `${first} asked a question. SDR answered briefly and proposed a call.`,
    };
  }
  return {
    subject,
    body: `Hi ${first},\n\nGlad the timing works. ${times}\n\n${sig}`,
    angle: `${first} is interested. SDR replied${slots.length ? ' with two times from your calendar' : bookingUrl ? ' with your booking link' : ''}.`,
  };
}

export const salesPurposes = {
  account_brief: briefFor,
  lead_score: leadScoreFor,
  outreach_draft: outreachFor,
  reply_classify: classifyFor,
  reply_draft: replyDraftFor,
};

// ── Handlers ────────────────────────────────────────────────────

function searchResults(co, max = 8) {
  const sigs = signalsOf(co);
  const results = [
    ...sigs.map((s) => ({ title: s.headline, url: s.url, snippet: s.sentence.replace(/^It /, `${co.name} `).replace(/^Its /, `${co.name}’s `), publishedAt: s.publishedAt })),
    { title: `${co.name} | ${co.industry} in ${co.city}`, url: `https://${co.domain}`, snippet: toAccount(co).description, publishedAt: null },
    { title: `${co.name} | LinkedIn`, url: `https://www.linkedin.com/company/${slug(co.name)}`, snippet: `${co.name} | ${Number(co.employees).toLocaleString('en-US')} employees | ${location(co)}`, publishedAt: null },
  ];
  return results.slice(0, max);
}

export const salesHandlers = {
  'accounts.search': (args, { io }) =>
    fake(io, 'apollo.organization_search', () => {
      const icp = args.icp ?? {};
      const exclude = new Set((args.excludeDomains ?? []).map(normDomain));
      const min = Number(icp.employeesMin) || 0;
      const max = Number(icp.employeesMax) || Infinity;
      const places = (icp.locations ?? []).map((l) => String(l).toLowerCase());
      const anyUs = !places.length || places.some((p) => /united states|^us$|^usa$|america/.test(p));
      const matches = COMPANIES.filter((c) => {
        if (exclude.has(c.domain)) return false;
        if (c.employees < min || c.employees > max) return false;
        if (anyUs) return true;
        const loc = location(c).toLowerCase();
        return places.some((p) => loc.includes(p) || p.includes(c.state.toLowerCase()));
      });
      // Sample data trickles in a few accounts per search so the team has a steady flow.
      const per = Math.min(Number(args.limit) || 10, 8);
      const start = (Math.max(1, Number(args.page) || 1) - 1) * per;
      return { accounts: matches.slice(start, start + per).map(toAccount) };
    }, { min: 300, max: 900 }),

  'accounts.enrich': (args, { io }) =>
    fake(io, 'apollo.organization_enrich', () => {
      const co = profileFor({ domain: args.domain });
      return { account: toAccount(co) };
    }, { min: 200, max: 400 }),

  'contacts.search': (args, { io }) =>
    fake(io, 'apollo.people_search', () => {
      const co = profileFor({ domain: args.domain, name: args.accountName });
      const wanted = (args.titles ?? []).map(words);
      const rank = (p) => (p.designed ? 100 : Math.max(0, ...wanted.map((w) => [...words(p.title)].filter((x) => w.has(x)).length)));
      const people = peopleFor(co)
        .map((p, i) => ({ p, i, score: rank(p) }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, Number(args.limit) || 3)
        .map(({ p }) => ({
          name: p.name,
          firstName: p.firstName,
          lastName: p.lastName,
          title: p.title,
          email: p.hideEmail ? undefined : p.email,
          linkedin: p.linkedin,
          location: p.location,
          seniority: p.seniority,
          externalId: p.externalId,
        }));
      return { contacts: people };
    }, { min: 250, max: 600 }),

  'contacts.enrich': (args, { io }) =>
    fake(io, 'apollo.people_match', () => {
      const c = args.contact ?? {};
      const domain = String(c.email ?? '').split('@')[1];
      const person = (domain && personByEmail(c.email)) || null;
      return { contact: { ...c, linkedin: c.linkedin ?? person?.linkedin ?? null, location: c.location ?? person?.location ?? null } };
    }, { min: 150, max: 350 }),

  'email.find': (args, { io }) =>
    fake(io, 'hunter.email_finder', () => {
      const co = profileFor({ domain: args.domain });
      const name = `${args.firstName} ${args.lastName}`.trim();
      const person = peopleFor(co).find((p) => p.name === name);
      const r = seeded(`${args.domain}:${name}:find`);
      const email = person?.email ?? emailFor(pick(seeded(`${co.domain}:people`), PATTERNS), args.firstName ?? 'info', args.lastName ?? '', co.domain);
      return { email, confidence: 82 + Math.floor(r() * 16) };
    }, { min: 400, max: 800 }),

  'email.verify': (args, { io }) =>
    fake(io, 'hunter.email_verifier', () => {
      const email = String(args.email ?? '').toLowerCase();
      const person = personByEmail(email);
      if (person?.status) return { status: person.status };
      const r = seeded(`${email}:verify`)();
      return { status: r < 0.74 ? 'verified' : r < 0.94 ? 'likely' : 'invalid' };
    }, { min: 700, max: 1300 }),

  'signals.funding': (args, { io }) =>
    fake(io, 'crunchbase.funding_rounds', () => {
      const co = profileFor({ domain: args.domain, name: args.name });
      const items = signalsOf(co)
        .filter((s) => s.type === 'Funding')
        .map(({ date, title, url }) => ({ type: 'Funding', date, title, url }));
      return { items };
    }, { min: 300, max: 600 }),

  'signals.hiring': (args, { io }) =>
    fake(io, 'apollo.organization_job_postings', () => {
      const co = profileFor({ domain: args.domain, name: args.name });
      const hiring = signalsOf(co).filter((s) => s.kind === 'hiring');
      const roles = (co.signals ?? []).find((s) => s.kind === 'hiring')?.roles ?? Math.floor(seeded(`${co.domain}:roles`)() * 4);
      return { openRoles: roles, items: hiring.map(({ date, title, url }) => ({ type: 'Hiring', date, title, url })) };
    }, { min: 250, max: 500 }),

  'social.search': (args, { io }) =>
    fake(io, 'exa.search', () => {
      const co = findCompanyIn(args.query);
      if (!co) return { items: [] };
      const exec = signalsOf(co).find((s) => s.kind === 'exec');
      if (!exec) return { items: [] };
      return {
        items: [{
          title: `${exec.person} on LinkedIn`,
          url: `https://www.linkedin.com/posts/${slug(exec.person)}-${slug(co.name)}`,
          publishedAt: exec.publishedAt,
          summary: `“Excited to join ${co.name}. First priority: get our authorization backlog under control.”`,
        }],
      };
    }, { min: 300, max: 700 }),

  'web.search': (args, { io }) =>
    fake(io, 'tavily.search', () => {
      const co = findCompanyIn(args.query);
      if (!co) {
        return {
          results: [{ title: `Search results for ${args.query}`, url: `https://www.google.com/search?q=${encodeURIComponent(args.query)}`, snippet: 'No specific coverage found.', publishedAt: null }],
        };
      }
      return { results: searchResults(co, Number(args.maxResults) || 8) };
    }, { min: 500, max: 1100 }),

  'web.fetch': (args, { io }) =>
    fake(io, 'tavily.extract', () => {
      const url = String(args.url ?? '');
      const host = normDomain(url);
      const co = findCompanyIn(url) ?? COMPANIES.find((c) => host.startsWith(c.domain)) ?? null;
      if (!co) return { url, title: host, text: '' };
      const sig = signalsOf(co).find((s) => s.url === url);
      const text = [
        sig ? `${sig.headline}. ${sig.sentence.replace(/^It /, `${co.name} `)}` : toAccount(co).description,
        co.about ? `${co.name} operates ${co.about}.` : '',
        co.workflow ?? '',
      ].filter(Boolean).join(' ');
      return { url, title: sig?.headline ?? co.name, text };
    }, { min: 700, max: 1400 }),

  'signals.news': (args, { io }) =>
    fake(io, 'newsapi.everything', () => {
      const co = findCompanyIn(args.query);
      if (!co) return { items: [] };
      const days = Number(args.days) || 120;
      const items = signalsOf(co)
        .filter((s) => ['News', 'Expansion', 'Funding'].includes(s.type) && s.days <= days)
        .map((s) => ({ title: s.headline, url: s.url, publishedAt: s.publishedAt, summary: s.sentence.replace(/^It /, `${co.name} `) }));
      return { items };
    }, { min: 300, max: 700 }),

  'crm.read': (args, { io }) =>
    fake(io, args.email ? 'hubspot.search_contacts' : 'hubspot.search_companies', () => {
      const domain = normDomain(args.domain ?? String(args.email ?? '').split('@')[1]);
      const company = crm.companies.get(domain) ?? null;
      const contact = args.email ? crm.contacts.get(String(args.email).toLowerCase()) ?? null : null;
      return { company, contact, isCustomer: !!BY_DOMAIN.get(domain)?.customer };
    }, { min: 150, max: 350 }),

  'crm.write': (args, { io }) => {
    const op = { upsert_company: 'hubspot.upsert_company', upsert_contact: 'hubspot.upsert_contact', log_email: 'hubspot.create_email', note: 'hubspot.create_note' }[args.op];
    if (!op) throw new ProviderError(`Unknown CRM operation "${args.op}"`, { status: 400, code: 'bad_request', op: 'hubspot' });
    return fake(io, op, () => {
      const nextId = () => String((crm.next += 7919));
      if (args.op === 'upsert_company') {
        const domain = normDomain(args.company?.domain);
        if (!crm.companies.has(domain)) {
          const id = nextId();
          crm.companies.set(domain, { id, url: `https://app.hubspot.com/contacts/4412/company/${id}` });
        }
        return crm.companies.get(domain);
      }
      if (args.op === 'upsert_contact') {
        const email = String(args.contact?.email ?? '').toLowerCase();
        if (!crm.contacts.has(email)) {
          const id = nextId();
          crm.contacts.set(email, { id, url: `https://app.hubspot.com/contacts/4412/contact/${id}` });
        }
        return crm.contacts.get(email);
      }
      crm.activities++;
      return { id: nextId() };
    }, { min: 150, max: 350 });
  },

  'email.send': (args, { io, workspace }) =>
    fake(io, 'gmail.users.messages.send', () => {
      const to = String(args.to ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        throw new ProviderError(`Recipient address rejected: ${args.to}`, { status: 400, code: 'bad_request', op: 'gmail.users.messages.send' });
      }
      let thread = args.threadId ? mail.threads.get(args.threadId) : null;
      if (!thread) {
        const id = args.threadId || hex(8);
        // An unknown thread id means the server restarted mid-conversation. Follow-ups can still
        // draw a reply; answers to the prospect's own messages stay quiet so the story stays coherent.
        thread = { id, to, toName: args.toName ?? '', domain: to.split('@')[1], subject: args.subject ?? '', outboundIds: [], inbound: [], done: !!args.inReplyTo };
        mail.threads.set(id, thread);
      }
      const messageId = `<${hex(12)}@mail.gmail.com>`;
      thread.outboundIds.push(messageId);
      mail.sent.push({ messageId, threadId: thread.id, to, subject: args.subject, body: args.body, at: new Date().toISOString() });
      planReply(thread, args.body, workspace);
      return { messageId, threadId: thread.id };
    }, { min: 300, max: 700 }),

  'email.read': (args, { io }) =>
    fake(io, 'gmail.users.messages.list', () => {
      const since = Date.parse(args.since ?? '') || 0;
      const now = Date.now();
      const only = Array.isArray(args.threadIds) && args.threadIds.length ? new Set(args.threadIds) : null;
      const messages = mail.inbox.filter((m) => {
        const at = Date.parse(m.at);
        return at > since && at <= now && (!only || only.has(m.threadId));
      });
      return { messages: messages.map((m) => ({ ...m })) };
    }, { min: 200, max: 500 }),

  'calendar.availability': (args, { io }) =>
    fake(io, 'google_calendar.freebusy.query', () => {
      const from = Date.parse(args.from ?? '') || Date.now();
      const to = Date.parse(args.to ?? '') || from + 7 * DAY;
      const dur = (Number(args.durationMin) || 30) * 60_000;
      const slots = [];
      const day = new Date(from);
      day.setUTCHours(0, 0, 0, 0);
      for (let t = day.getTime(); t <= to && slots.length < 40; t += DAY) {
        const wd = new Date(t).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        for (const h of [14, 15, 16, 17, 18, 19, 20]) {
          const start = t + h * 3_600_000;
          if (start < from || start + dur > to) continue;
          // Some hours are already taken.
          if (seeded(`busy:${new Date(start).toISOString()}`)() < 0.3) continue;
          slots.push({ start: new Date(start).toISOString(), end: new Date(start + dur).toISOString() });
        }
      }
      return { slots };
    }, { min: 200, max: 450 }),

  'calendar.book': (args, { io }) =>
    fake(io, 'google_calendar.events.insert', () => {
      const code = () => Array.from({ length: 3 }, () => 'abcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 25)]).join('');
      return { eventId: `evt_${hex(8)}`, link: `https://meet.google.com/${code()}-${code()}${code()[0]}-${code()}` };
    }, { min: 300, max: 600 }),
};
