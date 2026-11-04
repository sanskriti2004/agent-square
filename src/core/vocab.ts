export const TOPICS = [
  "food-delivery",
  "quick-commerce",
  "grocery",
  "pharmacy",
  "restaurants",
  "payments",
  "upi",
  "lending",
  "credit",
  "insurance",
  "wealth",
  "fintech-regulation",
  "ev",
  "bike-taxi",
  "ride-hailing",
  "micromobility",
  "logistics",
  "gig-workers",
  "railways",
  "e-catering",
  "aviation",
  "travel",
  "hotels",
  "e-commerce",
  "fashion",
  "social-commerce",
  "telecom",
  "5g",
  "broadband",
  "funding",
  "ipo",
  "earnings",
  "leadership",
  "partnership",
  "pricing",
  "sustainability",
  "regulation",
  "advertising",
  "ai",
] as const;

export type Topic = (typeof TOPICS)[number];

const TOPIC_PATTERNS: Record<Topic, RegExp> = {
  "food-delivery": /\b(food delivery|food-delivery|delivers? food|meals?|food orders?|order food|seat delivery)\b/i,
  "quick-commerce": /\b(quick[- ]commerce|q-?comm|10[- ]minute|15[- ]minute|dark stores?|instamart|minutes delivery|instant delivery)\b/i,
  grocery: /\b(grocer(y|ies)|fresh produce|fmcg)\b/i,
  pharmacy: /\b(pharmacy|pharmacies|medicines?)\b/i,
  restaurants: /\b(restaurants?|dining|dineout|cloud kitchens?)\b/i,
  payments: /\b(payments?|wallet|checkout|merchants?|transactions?|payment gateway)\b/i,
  upi: /\bupi\b/i,
  lending: /\b(loans?|lending|credit lines?|nbfc|bnpl)\b/i,
  credit: /\b(credit cards?|credit score|card bills?)\b/i,
  insurance: /\binsur(ance|tech|er)\b/i,
  wealth: /\b(mutual funds?|wealth|stock ?broking|demat)\b/i,
  "fintech-regulation": /\b(rbi|npci|payment aggregator|kyc)\b/i,
  ev: /\b(evs?|electric (vehicles?|scooters?|two-wheelers?|bikes?|fleets?)|battery swapping|charging)\b/i,
  "bike-taxi": /\bbike[- ]taxis?\b/i,
  "ride-hailing": /\b(ride[- ]hailing|cabs?|auto[- ]rickshaws?|ride bookings?)\b/i,
  micromobility: /\b(micro[- ]?mobility|e-?bikes?|shared bikes?|scooter rentals?)\b/i,
  logistics: /\b(logistics|last[- ]mile|fleets?|warehous(e|es|ing)|shipping|courier)\b/i,
  "gig-workers": /\b(gig workers?|delivery partners?|delivery executives?|delivery riders?|gig economy)\b/i,
  railways: /\b(railways?|irctc|trains?|railway stations?|pnr)\b/i,
  "e-catering": /\b(e-?catering|meals? (on|in) trains?|seat delivery|food (on|in) trains?)\b/i,
  aviation: /\b(airlines?|flights?|aviation|aircraft|airports?|dgca)\b/i,
  travel: /\b(travel|tourism|holidays?|trips?|travellers?|passengers?)\b/i,
  hotels: /\b(hotels?|homestays?)\b/i,
  "e-commerce": /\b(e-?commerce|online shopping|marketplace|online sellers?|festive sale)\b/i,
  fashion: /\b(fashion|apparel|myntra)\b/i,
  "social-commerce": /\b(social commerce|resellers?)\b/i,
  telecom: /\b(telecom|tariffs?|subscribers?|mobile plans?|spectrum|trai)\b/i,
  "5g": /\b5g\b/i,
  broadband: /\b(broadband|fiber|fibre|airfiber|wi-?fi)\b/i,
  funding: /\b(raises?|raised|funding|series [a-h]|valuation|investors?)\b/i,
  ipo: /\b(ipo|listing|sebi|drhp|public offer)\b/i,
  earnings: /\b(q[1-4]|quarterly|revenue|profit|net loss|results|ebitda|earnings)\b/i,
  leadership: /\b(ceo|cfo|coo|appoints?|appointed|steps down|chief executive)\b/i,
  partnership: /\b(partners with|partnership|ties? up|tie-up|teams up|collaborat(es|ion)|alliance|joins forces|pact|mou)\b/i,
  pricing: /\b(prices?|pricing|fees?|surge|discounts?|cheaper|price hike|tariff hike)\b/i,
  sustainability: /\b(sustainab(le|ility)|green|carbon|emissions?|net[- ]zero|clean energy)\b/i,
  regulation: /\b(regulat(ion|or|ory)|government|ministry|policy|ban|cci|antitrust|compliance)\b/i,
  advertising: /\b(advertising|ad campaign|brand ambassador|ads business)\b/i,
  ai: /\b(ai|artificial intelligence|genai|llms?|chatbots?|agentic)\b/i,
};

export function extractTopics(text: string): Topic[] {
  return TOPICS.filter((topic) => TOPIC_PATTERNS[topic].test(text));
}

export function cleanTopics(values: unknown): Topic[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set<string>(TOPICS);
  return [...new Set(values.map((v) => String(v).toLowerCase().trim()).filter((v) => allowed.has(v)))] as Topic[];
}

const SENSITIVE_PATTERNS = [
  /\blay ?offs?\b|\bsacks?\b|\bfired\b|\bjob cuts?\b/i,
  /\b(dies|died|death|deaths|killed|accident|crash|injured)\b/i,
  /\b(lawsuit|sued|sues|court|arrest(ed)?|fir|police|probe|raid(ed)?)\b/i,
  /\b(fraud|scam|money laundering|data breach|leak(ed)?)\b/i,
  /\b(shares?|stock) (fall|falls|fell|slump|slumps|crash|crashes|tank|tanks|plunge|plunges|jump|jumps|surge|surges|rally|rallies)\b/i,
  /\b(target price|price target|buy rating|sell rating|share price|brokerage)\b/i,
  /\b(fined|fines|penalty|penalties|waiver|show cause|crackdown)\b/i,
  /\b(harass(ment)?|assault|protest|strike)\b/i,
];

export function sensitiveMatch(text: string): string | null {
  for (const pattern of SENSITIVE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

type MentionTarget = { id: string; aliases: string[] };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string) {
  const caseSensitive = alias.length <= 5 && alias === alias.toUpperCase();
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(alias)}(?![A-Za-z0-9])`, caseSensitive ? "" : "i");
}

export function findMentions(text: string, agents: MentionTarget[], exclude?: string): string[] {
  const found = new Set<string>();
  for (const agent of agents) {
    if (agent.id === exclude) continue;
    if (agent.aliases.some((alias) => aliasPattern(alias).test(text))) found.add(agent.id);
    if (new RegExp(`@${escapeRegExp(agent.id)}\\b`, "i").test(text)) found.add(agent.id);
  }
  return [...found];
}

export function normalizeTitle(title: string): string {
  return title
    .replace(/\s+[-|–—]\s+[^-|–—]{2,60}$/u, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function splitPublisher(rawTitle: string): { title: string; publisher: string | null } {
  const match = rawTitle.match(/^(.*\S)\s+-\s+([^-]{2,80})$/u);
  if (!match) return { title: rawTitle.trim(), publisher: null };
  return { title: match[1].trim(), publisher: match[2].trim() };
}
