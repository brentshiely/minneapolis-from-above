import { isoDate, localParts, localTime, type CityStatus, type MplsDay, type StpPhase } from "./rules.ts";

/**
 * Reading each city's own snow emergency announcement. Neither city
 * publishes a snow emergency API, so these read what their websites show:
 *
 * Minneapolis: the site-wide notice feed behind the banner on every page of
 *   minneapolismn.gov. All winter it carries a notice with id
 *   "snow-emergency" that says either "A snow emergency is not currently in
 *   effect" or announces one. (The city: "If we declare a snow emergency,
 *   you'll see a banner at the top of every page.")
 * Saint Paul: the "Snow Emergency Status" section of the city's snow page.
 *
 * Both are free text written by people, so the parsers are strict: anything
 * they don't clearly recognize as a declared emergency reads as none, and
 * the map stays quiet rather than show a wrong rule.
 */

export const MPLS_SOURCE = "https://www.minneapolismn.gov/media/minneapolismngov/site-assets/javascript/site-wide-notices/emergency-en.json";
export const STP_SOURCE = "https://www.stpaul.gov/departments/public-works/street-maintenance/snow-emergency";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—" };

/** Tags out, entities decoded, whitespace collapsed. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Says plainly that there's no emergency (or that it's over). */
const NONE = /\bsnow emergency (is|was) (not|no longer)\b|\bno snow emergency\b|\bsnow emergency (has |was )?(ended|been lifted|been cancell?ed|is over|is lifted|lifted|cancell?ed)\b|\bnormal parking rules apply\b/i;
/** Says one is on. */
const DECLARED = /\bsnow emergency\b[^.]{0,40}\b(has been|was|is|is now|are|remains?) (declared|in effect)\b|\bsnow emergency (declared|in effect)\b|\bdeclared? a snow emergency\b|\bsnow emergency\b[^.]{0,20}\bday (1|2|3|one|two|three)\b|\bday (1|2|3|one|two|three)\b[^.]{0,40}\bsnow emergency\b|\b(night|day) plow routes?\b[^.]{0,40}\b(begin|start|in effect)/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_WORDS: Record<string, MplsDay> = { "1": 1, "2": 2, "3": 3, one: 1, two: 2, three: 3 };

/** Split at sentence ends, but not after "p.m.", "Dec." or "St." */
const sentences = (text: string) => text.split(/(?<![ap]\.m\.|\b(?:St|Ave|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec)\.)(?<=[.!])\s+(?=[A-Z])/);

/**
 * A calendar date in the text ("Tuesday, Dec. 2", "January 7", "12/2"),
 * as a Minneapolis date in the winter around `now`.
 */
export function findDate(text: string, now: Date): string | undefined {
  let month: number | undefined, day: number | undefined, year: number | undefined;
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d{2})\b)?/i.exec(text);
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/((?:20)?\d{2}))?\b/.exec(text);
  // Whichever comes first in the text.
  if (named && (!slash || named.index <= slash.index)) {
    month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1; day = Number(named[2]);
    if (named[3]) year = Number(named[3]);
  } else if (slash) {
    month = Number(slash[1]); day = Number(slash[2]);
    if (slash[3]) year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
  }
  if (!month || !day || month > 12 || day > 31) return undefined;
  if (!year) {
    // A December date read in January belongs to last year, and vice versa.
    const l = localParts(now);
    year = l.y;
    if (month - l.m > 6) year--;
    else if (l.m - month > 6) year++;
  }
  return isoDate(year, month, day);
}

/** A "YYYY-MM-DD" date moved by whole days. */
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The single "Day N" the text mentions, if it names exactly one. */
function onlyDay(text: string): MplsDay | undefined {
  const days = new Set([...text.matchAll(/\bday\s+(1|2|3|one|two|three)\b/gi)].map((m) => DAY_WORDS[m[1].toLowerCase()]));
  return days.size === 1 ? [...days][0] : undefined;
}

/**
 * The declaration date, from a date the text ties to a stage: "Day 2 rules
 * begin at 8 a.m. Thursday, Jan. 8" means it was declared Jan. 7. Each
 * stage pattern comes with how many days after the declaration it starts.
 * Failing that, a date in the sentence that says it was declared.
 */
function declarationDate(text: string, now: Date, stages: [RegExp, (m: RegExpMatchArray) => number][]): string | undefined {
  for (const s of sentences(text)) {
    for (const [re, offset] of stages) {
      const m = s.match(re);
      const date = m && findDate(s, now);
      if (m && date) return shiftDate(date, -offset(m));
    }
  }
  const declared = sentences(text).find((x) => /\bdeclared?\b/i.test(x));
  return declared ? findDate(declared, now) : undefined;
}

/**
 * Sentences about what happens "when a snow emergency is declared" are
 * explanation, not news; leave them out before deciding anything.
 */
const news = (text: string) => sentences(text).filter((x) => !/^(when|if|once|whenever|until)\b/i.test(x)).join(" ");

interface MplsNotice { id?: string; html?: string; description?: string; title?: string; publishDate?: string; expireDate?: string }

const DAY_RULES_ON = /\bday\s+(1|2|3|one|two|three)\s+rules\s+(?:are|is)\s+(?:now\s+)?in effect\b/i;
const DAY_RULES_NEXT = /\bday\s+(1|2|3|one|two|three)\s+rules\s+(?:begin|start)/i;

/**
 * Minneapolis: the site-wide notice feed. When the city declares an
 * emergency it schedules the whole thing at once, one notice per stage,
 * each with its own publish and expire time, all with the id
 * "snow-emergency" (as archived for February 22, 2023):
 *   until 9 p.m.   "The City has declared a Snow Emergency. Day 1 rules begin at 9 p.m. tonight."
 *   9 p.m.–8 a.m.  "Snow Emergency Day 1 rules are in effect from 9 p.m. until 8 a.m. (overnight). …"
 *   8 a.m.–8 p.m.  "Snow Emergency Day 2 rules are in effect from 8 a.m. until 8 p.m. tonight. …"
 *   8 p.m.–8 a.m.  "A Snow Emergency is in effect. Day 2 ended at 8 p.m. … Day 3 rules begin at 8 a.m."
 *   8 a.m.–8 p.m.  "Snow Emergency Day 3 rules are in effect from 8 a.m. until 8 p.m. tonight."
 * alongside a standing "There's currently no Snow Emergency" notice with
 * no expiry. The site shows the scheduled notice whose window is open, so
 * this does the same.
 */
export function parseMinneapolis(body: unknown, now = new Date()): CityStatus {
  const base = { source: MPLS_SOURCE };
  const notices = (body as { notices?: MplsNotice[] } | null)?.notices;
  if (!Array.isArray(notices)) return { ...base, ok: false, declared: false };
  const t = now.getTime();
  const live = notices.filter((n) => n && typeof n === "object" && (n.html || n.description)).map((n) => {
    const pub = n.publishDate ? Date.parse(n.publishDate) : NaN, exp = n.expireDate ? Date.parse(n.expireDate) : NaN;
    return {
      n, text: plainText(`${n.title ?? ""} ${n.description ?? messageOf(n.html ?? "")}`),
      pub: Number.isFinite(pub) ? pub : -Infinity, exp: Number.isFinite(exp) ? exp : Infinity,
    };
  }).filter((x) => x.pub <= t && t < x.exp);
  // Of the notices showing now that announce an emergency, the one with the
  // narrowest window is the stage the city scheduled for this moment.
  const hit = live
    .filter((x) => { const said = news(x.text); return !NONE.test(said) && DECLARED.test(said); })
    .sort((a, b) => (a.exp - a.pub) - (b.exp - b.pub))[0];
  if (!hit) {
    const standing = live.find((x) => x.n.id === "snow-emergency") ?? live.find((x) => /snow emergency/i.test(x.text));
    return { ...base, ok: true, declared: false, ...(standing ? { message: standing.text } : {}) };
  }
  const message = hit.text, said = news(message);
  let day: MplsDay | undefined, before = false;
  const on = DAY_RULES_ON.exec(said), next = DAY_RULES_NEXT.exec(said);
  if (on) day = DAY_WORDS[on[1].toLowerCase()];
  else if (next) { day = DAY_WORDS[next[1].toLowerCase()]; before = true; }
  else day = onlyDay(said);

  let declaredOn: string | undefined, until: string | undefined;
  if (Number.isFinite(hit.exp)) until = new Date(hit.exp).toISOString();
  if (day && Number.isFinite(hit.pub)) {
    // Each stage's notice goes up on a known day of the emergency.
    const p = localParts(new Date(hit.pub));
    declaredOn = shiftDate(isoDate(p.y, p.m, p.d), -(day === 1 ? 0 : day === 2 ? 1 : before ? 1 : 2));
  } else {
    declaredOn = declarationDate(said, now, [[/\bday\s+(1|2|3|one|two|three)\b/i, (m) => DAY_WORDS[m[1].toLowerCase()] - 1]]);
    // "Declared", with no day and no date, is the announcement itself: the
    // banner's own date (it's re-dated each day) is the declaration date.
    if (!declaredOn && !day && /\bdeclared?\b/i.test(said)) declaredOn = findDate(plainText(dateOf(hit.n.html ?? "")), now);
  }
  // "A one-day Snow Emergency has been declared for tonight, from 9 p.m.
  // Feb. 24 to 8 a.m. Feb. 25": day 1 only.
  // Day 1 only, so no declaration date to count days 2 and 3 from.
  if (/\bone-day\b/i.test(said) && declaredOn) {
    const l = localParts(now);
    day = 1;
    before = isoDate(l.y, l.m, l.d) === declaredOn && l.hour < 21;
    until ??= localTime(shiftDate(declaredOn, 1), 8).toISOString();
    declaredOn = undefined;
  }
  return {
    ...base, ok: true, declared: true, message,
    ...(day ? { day } : {}), ...(before ? { before } : {}), ...(declaredOn ? { declaredOn } : {}), ...(until ? { until } : {}),
  };
}

/** The notice's message, without the button labels around it. */
function messageOf(html: string): string {
  const m = /<div class="message">([\s\S]*?)<\/div>/i.exec(html);
  if (!m) return html;
  // The message repeats itself for screen readers; keep one copy.
  const sr = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(m[1]);
  return sr ? sr[1] : m[1];
}

/** The banner's date block ("Wednesday, January 7"). */
function dateOf(html: string): string {
  return /<div class="date">([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? "";
}

/**
 * Saint Paul: the snow page. A declared emergency has appeared as an alert
 * box at the top of the page ("A Snow Emergency for Saint Paul is now in
 * effect.", December 2024); the page also has a "Snow Emergency Status"
 * section that says "There is currently no Snow Emergency in effect."
 */
export function parseSaintPaul(html: string, now = new Date()): CityStatus {
  const base = { source: STP_SOURCE };
  const alert = [...html.matchAll(/<section class="alert-box">([\s\S]*?)<\/section>/gi)].map((m) => plainText(m[1])).find((t) => /snow emergency/i.test(t));
  let status: string | undefined;
  const at = html.search(/id="snow-emergency-status"/i);
  if (at >= 0) {
    // The section runs until the next paragraph's anchor.
    const rest = html.slice(at);
    const end = rest.slice(30).search(/class="paragraph-anchor"|<footer/i);
    status = plainText(rest.slice(rest.indexOf(">") + 1, end < 0 ? 4000 : end + 30)).replace(/^Snow Emergency Status\s*/i, "");
  }
  const message = alert || status;
  if (!message) return { ...base, ok: false, declared: false };
  const said = news(message);
  if (NONE.test(said) || !DECLARED.test(said)) return { ...base, ok: true, declared: false, message: sentences(message)[0] };
  const declaredOn = declarationDate(said, now, [[/\bnight plow\b/i, () => 0], [/\bday plow\b/i, () => 1]]);
  // "We are now in the Clean Up Phase" settles it; otherwise a notice that
  // names only one plow phase is in that phase.
  const night = /\bnight plow\b/i.test(said), day = /\bday plow\b/i.test(said);
  const phase: StpPhase | undefined = /\bnow in the clean ?up phase\b/i.test(said) ? "cleanup" : day && !night ? "day" : night && !day ? "night" : undefined;
  return { ...base, ok: true, declared: true, message: sentences(message)[0], ...(phase ? { phase } : {}), ...(declaredOn ? { declaredOn } : {}) };
}
