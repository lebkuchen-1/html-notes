import nspell from 'nspell';
import { createSignal } from 'solid-js';
import type { SpellCheckLanguage } from '../types';

type SingleLang = 'de' | 'en';
type NSpellInstance = ReturnType<typeof nspell>;

export interface SpellIssue {
  word: string;
  start: number;
  end: number;
}

const PERSONAL_DICT_KEY = 'solid-notes:v1:personalDict';
const DICT_CACHE_NAME = 'notizblock-spell-dicts-v1';

const [spellCheckRevision, setSpellCheckRevision] = createSignal(0);
const [spellCheckLoading, setSpellCheckLoading] = createSignal(false);

const checkers: Partial<Record<SingleLang, NSpellInstance>> = {};
const loadingPromises: Partial<Record<SingleLang, Promise<NSpellInstance | null>>> = {};
const wordResultCache: Record<SpellCheckLanguage, Map<string, boolean>> = {
  'de-en': new Map(),
  de: new Map(),
  en: new Map(),
};

let personalWords = loadPersonalDictionaryFromStorage();
let personalWordsLower = new Set(personalWords.map((w) => w.toLowerCase()));

function bumpRevision() {
  wordResultCache['de-en'].clear();
  wordResultCache.de.clear();
  wordResultCache.en.clear();
  setSpellCheckRevision((v) => v + 1);
}

function loadPersonalDictionaryFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(PERSONAL_DICT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
      .map((w) => w.trim());
  } catch {
    return [];
  }
}

function savePersonalDictionaryToStorage(words: string[]): void {
  try {
    localStorage.setItem(PERSONAL_DICT_KEY, JSON.stringify(words));
  } catch {
    // ignore storage quota issues
  }
}

export function getSpellCheckRevision(): number {
  return spellCheckRevision();
}

export function isSpellCheckLoading(): boolean {
  return spellCheckLoading();
}

export function getHtmlLangForSpellCheck(lang: SpellCheckLanguage): string {
  if (lang === 'en') return 'en-US';
  return 'de-DE';
}

export function getSpellLanguageShortLabel(lang: SpellCheckLanguage): string {
  if (lang === 'de') return 'DE';
  if (lang === 'en') return 'EN';
  return 'DE·EN';
}

export function getSpellLanguageLabel(lang: SpellCheckLanguage): string {
  if (lang === 'de') return 'Deutsch';
  if (lang === 'en') return 'Englisch';
  return 'Deutsch + Englisch';
}

export function getPersonalDictionary(): string[] {
  void spellCheckRevision();
  return [...personalWords];
}

export function addWordToPersonalDictionary(word: string): void {
  const cleaned = word.trim();
  if (!cleaned) return;
  const lower = cleaned.toLowerCase();
  if (personalWordsLower.has(lower)) return;

  personalWords = [...personalWords, cleaned].sort((a, b) =>
    a.localeCompare(b, 'de', { sensitivity: 'base' })
  );
  personalWordsLower.add(lower);
  savePersonalDictionaryToStorage(personalWords);

  if (checkers.de) checkers.de.add(cleaned);
  if (checkers.en) checkers.en.add(cleaned);
  bumpRevision();
}

export function removeWordFromPersonalDictionary(word: string): void {
  const lower = word.trim().toLowerCase();
  if (!personalWordsLower.has(lower)) return;
  const removed = personalWords.filter((w) => w.toLowerCase() === lower);
  personalWords = personalWords.filter((w) => w.toLowerCase() !== lower);
  personalWordsLower = new Set(personalWords.map((w) => w.toLowerCase()));
  savePersonalDictionaryToStorage(personalWords);

  for (const w of removed) {
    if (checkers.de) checkers.de.remove(w);
    if (checkers.en) checkers.en.remove(w);
  }
  bumpRevision();
}

async function fetchDictionaryText(url: string): Promise<string> {
  // Try Cache API first so dictionaries stay instantly available offline on iPad PWA
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(DICT_CACHE_NAME);
      const cached = await cache.match(url);
      if (cached && cached.ok) {
        return await cached.text();
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      void cache.put(url, response.clone()).catch(() => {});
      return await response.text();
    } catch {
      // Fall through to plain fetch if Cache API is blocked in private mode
    }
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

function getRequiredLanguages(lang: SpellCheckLanguage): SingleLang[] {
  if (lang === 'de') return ['de'];
  if (lang === 'en') return ['en'];
  return ['de', 'en'];
}

export function isSpellCheckerReady(lang: SpellCheckLanguage): boolean {
  const req = getRequiredLanguages(lang);
  return req.every((l) => Boolean(checkers[l]));
}

function preprocessGermanDicForNspell(rawDic: string): string {
  // nspell merges flags when a word appears twice in de.dic (e.g. "gehen/DIVXW" and "gehen/Sozm"),
  // which accidentally attaches ONLYINCOMPOUND ('o') to normal German verbs like "gehen" or "schreiben".
  // Removing ONLYINCOMPOUND ('o') compound-part entries fixes standalone verbs while our German
  // compound checker handles compounds cleanly.
  const lines = rawDic.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0) {
      kept.push(line);
      continue;
    }
    const slash = line.indexOf('/');
    if (slash >= 0 && line.slice(slash + 1).includes('o')) {
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

async function loadSingleDictionary(lang: SingleLang): Promise<NSpellInstance | null> {
  if (checkers[lang]) return checkers[lang]!;
  if (loadingPromises[lang]) return loadingPromises[lang]!;

  const base = import.meta.env.BASE_URL || './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const affUrl = `${normalizedBase}dictionaries/${lang}.aff`;
  const dicUrl = `${normalizedBase}dictionaries/${lang}.dic`;

  const promise = (async () => {
    try {
      const [aff, rawDic] = await Promise.all([
        fetchDictionaryText(affUrl),
        fetchDictionaryText(dicUrl),
      ]);
      const dic = lang === 'de' ? preprocessGermanDicForNspell(rawDic) : rawDic;
      const instance = nspell(aff, dic);
      for (const word of personalWords) {
        instance.add(word);
      }
      checkers[lang] = instance;
      bumpRevision();
      return instance;
    } catch (err) {
      console.warn(`[spellcheck] Failed to load ${lang} dictionary:`, err);
      return null;
    } finally {
      delete loadingPromises[lang];
      setSpellCheckLoading(Object.keys(loadingPromises).length > 0);
    }
  })();

  loadingPromises[lang] = promise;
  setSpellCheckLoading(true);
  return promise;
}

/**
 * Ensures the required Hunspell dictionary (de, en, or both) is loaded in memory.
 * Safe to call repeatedly; loads each dictionary at most once.
 */
export async function ensureSpellCheckerLoaded(
  lang: SpellCheckLanguage
): Promise<boolean> {
  const req = getRequiredLanguages(lang);
  if (req.every((l) => Boolean(checkers[l]))) return true;
  await Promise.all(req.map((l) => loadSingleDictionary(l)));
  return req.every((l) => Boolean(checkers[l]));
}

// Common tech/UI terms & abbreviations that shouldn't constantly trigger false positives
const BUILTIN_IGNORE_WORDS = new Set([
  'ipad',
  'ipados',
  'iphone',
  'ios',
  'macos',
  'apple',
  'pencil',
  'scribble',
  'kritzeln',
  'goodnotes',
  'onenote',
  'notizblock',
  'markdown',
  'canvas',
  'pdf',
  'pdfs',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'svg',
  'html',
  'css',
  'json',
  'http',
  'https',
  'wlan',
  'wifi',
  'todo',
  'todos',
  'okay',
  'ok',
  'app',
  'apps',
  'webapp',
  'webapps',
  'solidjs',
  'typescript',
  'javascript',
  'github',
  'browser',
  'safari',
  'chrome',
  'stylus',
  'touchpad',
  'trackpad',
  'zoom',
  'zoomen',
  'scrollen',
  'backup',
  'autosave',
  'download',
  'upload',
  'online',
  'offline',
  'update',
  'updates',
  'feature',
  'features',
  'bug',
  'bugs',
  'login',
  'logout',
  'email',
  'emails',
  'e-mail',
  'e-mails',
  'checkliste',
  'checklisten',
  'dashboard',
  'workflow',
  'workflows',
  'meeting',
  'meetings',
  'deadline',
  'deadlines',
  'feedback',
  'sprint',
  'roadmap',
  'milestone',
  'milestones',
  'bzw',
  'usw',
  'etc',
  'evtl',
  'ggf',
  'inkl',
  'exkl',
  'ca',
  'min',
  'max',
  'nr',
  'tel',
  'str',
  'dr',
  'prof',
  'z.b',
  'd.h',
  'u.a',
]);

function checkSingleInGerman(de: NSpellInstance, word: string): boolean {
  if (de.correct(word)) return true;

  // German sentence-start capitalization: if word starts with capital and rest is lowercase,
  // also check lowercase form (e.g. "Heute", "Schnell")
  const first = word[0];
  const rest = word.slice(1);
  if (first && first === first.toUpperCase() && rest === rest.toLowerCase()) {
    if (de.correct(word.toLowerCase())) return true;
  }

  // Swiss/alternative ss <-> ß tolerance? No, keep German ß rules accurate,
  // but check two-part German compound words (Komposita) for words >= 8 chars
  if (word.length >= 8 && /^[A-Za-zÄÖÜäöüß]+$/.test(word)) {
    const lower = word.toLowerCase();
    const linking = ['', 's', 'es', 'n', 'en', 'e'];
    for (let split = 3; split <= lower.length - 3; split++) {
      const leftRaw = lower.slice(0, split);
      const leftCap = leftRaw[0].toUpperCase() + leftRaw.slice(1);
      if (!de.correct(leftRaw) && !de.correct(leftCap)) continue;

      for (const link of linking) {
        const rightStart = split + link.length;
        if (lower.length - rightStart < 3) continue;
        if (link.length > 0 && lower.slice(split, rightStart) !== link) continue;

        const rightRaw = lower.slice(rightStart);
        const rightCap = rightRaw[0].toUpperCase() + rightRaw.slice(1);
        if (de.correct(rightRaw) || de.correct(rightCap)) {
          return true;
        }
      }
    }
  }

  return false;
}

function checkSingleInEnglish(en: NSpellInstance, word: string): boolean {
  if (en.correct(word)) return true;
  const normalizedQuote = word.replace(/’/g, "'");
  if (normalizedQuote !== word && en.correct(normalizedQuote)) return true;

  const first = normalizedQuote[0];
  const rest = normalizedQuote.slice(1);
  if (first && first === first.toUpperCase() && rest === rest.toLowerCase()) {
    if (en.correct(normalizedQuote.toLowerCase())) return true;
  }
  return false;
}

function shouldSkipToken(word: string): boolean {
  if (word.length <= 1) return true;
  // Numbers or tokens containing digits (e.g. 2026, A4, 120Hz, 3x)
  if (/\d/.test(word)) return true;
  // All-uppercase acronyms of length 2..6 (e.g. PDF, API, HTML, USA, DIN)
  if (word.length <= 6 && word === word.toUpperCase() && /[A-ZÄÖÜ]/.test(word)) {
    return true;
  }
  // CamelCase identifiers (e.g. iPadOS, SolidJS, GitHub)
  if (/[a-zäöü][A-ZÄÖÜ]/.test(word)) return true;

  const lower = word.toLowerCase();
  if (BUILTIN_IGNORE_WORDS.has(lower)) return true;
  if (personalWordsLower.has(lower)) return true;
  return false;
}

function checkAtomicWord(word: string, lang: SpellCheckLanguage): boolean {
  if (shouldSkipToken(word)) return true;

  const req = getRequiredLanguages(lang);
  let checkedAny = false;

  for (const l of req) {
    const inst = checkers[l];
    if (!inst) continue;
    checkedAny = true;
    if (l === 'de' && checkSingleInGerman(inst, word)) return true;
    if (l === 'en' && checkSingleInEnglish(inst, word)) return true;
  }

  // If dictionaries haven't loaded yet, don't flag words as wrong
  if (!checkedAny) return true;
  return false;
}

/**
 * Synchronous cached spellcheck for a single word token.
 * Returns true if the word is valid (or dictionaries are not yet loaded).
 */
export function isWordCorrectSync(word: string, lang: SpellCheckLanguage): boolean {
  if (!word || shouldSkipToken(word)) return true;
  if (!isSpellCheckerReady(lang)) return true;

  const cache = wordResultCache[lang];
  const cached = cache.get(word);
  if (cached !== undefined) return cached;

  let valid = checkAtomicWord(word, lang);

  // Hyphenated words (e.g. "Handschrift-Modus", "Drag-and-Drop", "E-Mail"):
  // valid if whole word is valid OR every non-empty part is valid
  if (!valid && word.includes('-')) {
    const parts = word.split('-').filter((p) => p.length > 0);
    if (parts.length >= 2 && parts.every((part) => checkAtomicWord(part, lang))) {
      valid = true;
    }
  }

  if (cache.size > 12000) {
    cache.clear();
  }
  cache.set(word, valid);
  return valid;
}

// Matches URLs, emails, Markdown code spans, note-img:// links, or words with letters/umlauts/apostrophes/hyphens
const TOKEN_REGEX =
  /```[\s\S]*?```|`[^`\n]+`|https?:\/\/\S+|www\.\S+|note-img:\/\/\S+|\S+@\S+\.\S+|#[A-Za-zÄÖÜäöüß0-9_-]+|([A-Za-zÄÖÜäöüß]+(?:['’\-][A-Za-zÄÖÜäöüß]+)*)/g;

/**
 * Finds all misspelled words with exact character offsets in `text`.
 * Automatically ignores URLs, emails, hashtags, and Markdown code blocks/spans.
 */
export function findSpellIssues(
  text: string,
  lang: SpellCheckLanguage,
  options?: { isMarkdown?: boolean }
): SpellIssue[] {
  if (!text || !isSpellCheckerReady(lang)) return [];
  const issues: SpellIssue[] = [];
  const isMd = Boolean(options?.isMarkdown);

  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const word = match[1];
    if (!word) continue; // skipped URL, code block, email, hashtag
    // In Markdown, also ignore raw image/link URLs inside (...), e.g. ](path/file.png)
    if (isMd && match.index > 0 && text[match.index - 1] === '(') {
      const closing = text.indexOf(')', match.index);
      if (closing > match.index && text[match.index - 2] === ']') {
        continue;
      }
    }
    if (!isWordCorrectSync(word, lang)) {
      issues.push({
        word,
        start: match.index,
        end: match.index + word.length,
      });
    }
  }
  return issues;
}

function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const prev = new Array<number>(bl + 1);
  const curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bl; j++) prev[j] = curr[j];
  }
  return prev[bl];
}

/**
 * Returns top ranked spelling suggestions across active languages (DE, EN, or DE+EN).
 */
export function getSpellSuggestions(
  word: string,
  lang: SpellCheckLanguage,
  limit = 6
): string[] {
  const cleaned = word.trim();
  if (!cleaned) return [];
  const req = getRequiredLanguages(lang);
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const l of req) {
    const inst = checkers[l];
    if (!inst) continue;
    const rawSuggestions = inst.suggest(cleaned);
    for (const s of rawSuggestions) {
      if (!s || s.startsWith('-') || s.endsWith('-')) continue;
      const key = s.toLowerCase();
      if (key === cleaned.toLowerCase() && s === cleaned) continue;
      if (!seen.has(s)) {
        seen.add(s);
        candidates.push(s);
      }
    }
  }

  // Fallback for mistyped German compound words (e.g. "Hndschrift" -> "Handschrift")
  if (candidates.length === 0 && req.includes('de') && checkers.de && cleaned.length >= 7) {
    const de = checkers.de;
    const lower = cleaned.toLowerCase();
    const isCap = cleaned[0] === cleaned[0]?.toUpperCase();
    for (let split = 3; split <= lower.length - 4; split++) {
      const right = lower.slice(split);
      const rightCap = right[0].toUpperCase() + right.slice(1);
      if (!de.correct(right) && !de.correct(rightCap)) continue;
      const left = cleaned.slice(0, split);
      const leftSugs = de
        .suggest(left)
        .filter((s) => s.length >= 2 && !s.startsWith('-') && !s.endsWith('-') && !s.includes(' '))
        .slice(0, 3);
      for (const ls of leftSugs) {
        const joined = isCap
          ? ls[0].toUpperCase() + ls.slice(1) + right
          : ls.toLowerCase() + right;
        if (!seen.has(joined)) {
          seen.add(joined);
          candidates.push(joined);
        }
      }
      if (candidates.length >= limit) break;
    }
  }

  const targetLower = cleaned.toLowerCase();
  const startsUpper = cleaned[0] === cleaned[0]?.toUpperCase();

  candidates.sort((a, b) => {
    const da = levenshtein(targetLower, a.toLowerCase());
    const db = levenshtein(targetLower, b.toLowerCase());
    if (da !== db) return da - db;
    // Prefer matching initial capitalization
    const ca = (a[0] === a[0]?.toUpperCase()) === startsUpper ? 0 : 1;
    const cb = (b[0] === b[0]?.toUpperCase()) === startsUpper ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.length - b.length;
  });

  return candidates.slice(0, limit);
}

/**
 * Replaces a single SpellIssue range cleanly inside `text`.
 */
export function applySpellReplacement(
  text: string,
  issue: SpellIssue,
  replacement: string
): string {
  if (
    issue.start < 0 ||
    issue.end > text.length ||
    text.slice(issue.start, issue.end) !== issue.word
  ) {
    // Fallback if text shifted slightly
    const idx = text.indexOf(issue.word);
    if (idx < 0) return text;
    return text.slice(0, idx) + replacement + text.slice(idx + issue.word.length);
  }
  return text.slice(0, issue.start) + replacement + text.slice(issue.end);
}
