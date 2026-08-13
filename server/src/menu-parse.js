/*
 * Paste-a-menu parser.
 *
 * Typing a 40-item Arabic menu by hand is the most tedious part of running this
 * app. This turns a blob of pasted text — from a WhatsApp message, a PDF, a
 * transcription of a photo — into rows the admin can eyeball and correct.
 *
 * Everything here is pure: text in, rows out, no database, no I/O. That makes
 * it cheap to test against a fixture table of real-world mess (see
 * server/test/menu-parse.test.js) and means the preview the admin sees is
 * produced by exactly the same code path as the save.
 *
 * It never writes anything and never silently "fixes" a price. Where it is
 * unsure it sets a flag and lets the admin decide.
 */

/* ------------------------------------------------------------------ */
/*  digits                                                             */
/* ------------------------------------------------------------------ */

/*
 * Arabic-Indic (٠١٢٣٤٥٦٧٨٩) and Extended/Persian Arabic-Indic (۰۱۲۳۴۵۶۷۸۹).
 * Menus in the region mix these with ASCII digits freely, sometimes inside one
 * line. Everything downstream assumes ASCII, so normalise first.
 */
const ARABIC_INDIC_OFFSET = 0x0660; // ٠
const EXTENDED_INDIC_OFFSET = 0x06f0; // ۰

export function normalizeDigits(input) {
  return String(input ?? "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.codePointAt(0);
    const base = code <= 0x0669 ? ARABIC_INDIC_OFFSET : EXTENDED_INDIC_OFFSET;
    return String(code - base);
  });
}

/*
 * Group separators that can appear *inside* a number: ASCII comma, Arabic
 * thousands separator (٬ U+066C), Arabic comma (، U+060C, used loosely),
 * thin space, plain space, apostrophe, and '.' in the European 15.000 style.
 *
 * '.' is deliberately only allowed in exact groups of three, so a run of dot
 * leaders ("صنف ......... 15000") can never be mistaken for part of the price.
 */
const PRICE_TAIL =
  /(\d{1,3}(?:[,٬، '’. ]\d{3})+|\d+)\s*$/;

/*
 * Currency written after the number, stripped before looking for the price.
 *
 * The leading (^|[\s\d]) is load-bearing. Without it the Latin abbreviations
 * match the tail of ordinary words — "Grills" ends in "ls", "Crisp" ends in
 * "sp" — and the parser quietly truncates item names to "Gril" and "Cri". A
 * currency mark only counts when it follows a digit or a space, never when it
 * is glued to letters. The captured character is put back.
 */
const CURRENCY_TAIL =
  /(^|[\s\d])\s*(?:ل\.?\s?س\.?|ليرة(?:\s+سورية)?|س\.?\s?ل\.?|SYP|SP|LS|£)\s*$/i;

/* Characters that signal "name over here, price over there". */
const SEPARATOR_CHARS = /[—–\-_:\t….،,]|\s{2,}/;

/* A line that is only decoration: ----, ====, ****, ___, ~~~~ */
const DECORATION_ONLY = /^[\s\-=*_~•·—–]+$/;

/* Leading list markers: bullets, and "1." / "2)" style numbering. */
const LEADING_MARKER = /^[\s•*▪‣·\-–—]+|^\d{1,2}[.)]\s+/;

/* Trailing junk left over once the price is removed: dot leaders, dashes, tabs. */
const TRAILING_JUNK = /[\s.…\-—–_:،,\t]+$/;

/** Parse a numeric token that may carry group separators. Returns null if not a number. */
export function parsePrice(token) {
  if (token == null) return null;
  const cleaned = normalizeDigits(token).replace(/[,٬، '’. ]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/*  line classification                                                */
/* ------------------------------------------------------------------ */

/**
 * Work out what a single line is, without looking at its neighbours.
 * Returns one of: empty | decoration | priced | unpriced | bare
 *
 *   priced    — a name and a price we could read
 *   unpriced  — has a separator, so it *meant* to carry a price, but we
 *               couldn't read one. An item at 0, flagged.
 *   bare      — no digits, no separator. Could be a category header or an
 *               item with no price; only context can tell (see classify()).
 */
function classifyLine(rawLine) {
  const raw = rawLine;
  const trimmed = normalizeDigits(rawLine).trim();

  if (!trimmed) return { type: "empty", raw };
  if (DECORATION_ONLY.test(trimmed)) return { type: "decoration", raw };

  // "المشاوي:" — an explicit header, whatever else is on the line.
  const colonHeader = trimmed.match(/^(.+?)\s*[:：]\s*$/);
  if (colonHeader && !/\d/.test(colonHeader[1])) {
    return { type: "header", name: colonHeader[1].trim(), raw, explicit: true };
  }

  let working = trimmed.replace(LEADING_MARKER, "").trim();
  const withoutCurrency = working.replace(CURRENCY_TAIL, "$1");
  const hadCurrency = withoutCurrency !== working;
  working = withoutCurrency;

  const tail = working.match(PRICE_TAIL);
  if (tail) {
    const price = parsePrice(tail[1]);
    const name = working.slice(0, tail.index).replace(TRAILING_JUNK, "").trim();
    // "15000" on its own is a price with nothing to attach it to.
    if (name && price != null) {
      return { type: "priced", name, price, raw, hadCurrency };
    }
    if (!name && price != null) {
      return { type: "orphanPrice", price, raw };
    }
  }

  const hasSeparator = SEPARATOR_CHARS.test(working);
  const hasDigits = /\d/.test(working);
  const name = working.replace(TRAILING_JUNK, "").trim();

  if (hasSeparator || hasDigits) {
    // It reads like an item whose price we couldn't make out.
    return { type: "unpriced", name: name || working.trim(), raw };
  }
  return { type: "bare", name, raw };
}

/* ------------------------------------------------------------------ */
/*  parse                                                              */
/* ------------------------------------------------------------------ */

/**
 * A bare line — no digits, no separator — is genuinely ambiguous. The brief
 * calls for both "a bare line with no price → an item at price 0, flagged" and
 * "a line with no digits and no separator → a category header", which describe
 * the same input.
 *
 * Resolved by looking ahead: a header is a line that has something under it.
 * If the next line carrying content is a priced item, the bare line was a
 * heading; otherwise it is an item nobody wrote a price for. Either way the
 * admin sees the decision in the preview and can flip it before saving.
 */
function looksLikeHeader(index, classified) {
  // "مطعم الشام" underlined with ==== or ---- is a heading, by typography.
  if (classified[index + 1]?.type === "decoration") return true;

  for (let i = index + 1; i < classified.length; i++) {
    const next = classified[i];
    if (next.type === "decoration") continue;
    // A heading has its items directly beneath it. A blank line in between
    // reads as a section break, which makes a stray name an item that nobody
    // wrote a price for — "مياه معدنية" at the end of the drinks list.
    if (next.type === "empty") return false;
    return next.type === "priced";
  }
  return false; // nothing follows it — a trailing name is an item, not a heading
}

/**
 * Parse pasted menu text.
 *
 * @param {string} text
 * @returns {{
 *   rows: Array<{line:number, raw:string, name:string, price:number,
 *                category:string, kind:'item', flags:string[],
 *                suggestedPrice:number|null}>,
 *   headers: Array<{line:number, name:string}>,
 *   skipped: Array<{line:number, raw:string, reason:string}>,
 *   stats: {items:number, categories:number, flagged:number, medianPrice:number|null}
 * }}
 */
export function parseMenu(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const classified = lines.map(classifyLine);

  const rows = [];
  const headers = [];
  const skipped = [];
  let category = "";

  classified.forEach((c, i) => {
    const line = i + 1;

    switch (c.type) {
      case "empty":
        return;
      case "decoration":
        skipped.push({ line, raw: c.raw, reason: "decoration" });
        return;
      case "orphanPrice":
        skipped.push({ line, raw: c.raw, reason: "price_without_name" });
        return;
      case "header":
        category = c.name;
        headers.push({ line, name: c.name });
        return;
      case "bare": {
        if (looksLikeHeader(i, classified)) {
          category = c.name;
          headers.push({ line, name: c.name });
          return;
        }
        rows.push({
          line, raw: c.raw, name: c.name, price: 0, category,
          kind: "item", flags: ["no_price"], suggestedPrice: null
        });
        return;
      }
      case "unpriced":
        rows.push({
          line, raw: c.raw, name: c.name, price: 0, category,
          kind: "item", flags: ["no_price"], suggestedPrice: null
        });
        return;
      case "priced":
        rows.push({
          line, raw: c.raw, name: c.name, price: c.price, category,
          kind: "item", flags: [], suggestedPrice: null
        });
        return;
    }
  });

  flagImplausiblePrices(rows);
  flagDuplicates(rows);

  const priced = rows.filter((r) => r.price > 0).map((r) => r.price);
  return {
    rows,
    headers,
    skipped,
    stats: {
      items: rows.length,
      categories: new Set(rows.map((r) => r.category).filter(Boolean)).size,
      flagged: rows.filter((r) => r.flags.length > 0).length,
      medianPrice: priced.length ? median(priced) : null
    }
  };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/*
 * Some menus write 15 to mean 15,000 — the thousands are understood by anyone
 * who eats there. We must not guess: silently multiplying by 1000 turns a
 * genuine 500 SYP glass of tea into 500,000. Instead, compare each price to the
 * median and flag anything two orders of magnitude below it, with a suggestion
 * the admin can accept in one tap.
 *
 * Needs a few priced rows before a median means anything.
 */
const IMPLAUSIBLE_RATIO = 50;

function flagImplausiblePrices(rows) {
  const priced = rows.filter((r) => r.price > 0);
  if (priced.length < 3) return;

  const m = median(priced.map((r) => r.price));
  if (!m) return;

  for (const row of priced) {
    if (m / row.price >= IMPLAUSIBLE_RATIO) {
      row.flags.push("implausible_price");
      row.suggestedPrice = row.price * 1000;
    }
  }
}

/* Same dish twice usually means the paste overlapped, or a size variant was
   flattened. Worth a look, not worth refusing to import. */
function flagDuplicates(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = row.name.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) row.flags.push("duplicate");
    else seen.set(key, row);
  }
}
