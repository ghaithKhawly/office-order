/*
 * The paste-a-menu parser.
 *
 * A fixture table of the mess real menus actually arrive in — WhatsApp
 * forwards, PDF copy-paste, someone typing from a photo. Each case is written
 * as the raw text an admin would paste and the rows they should see in the
 * preview.
 *
 * The parser's contract is that it never silently invents a price. Where it is
 * unsure it flags the row, and these tests pin that behaviour down: getting a
 * price wrong quietly is worse than refusing to guess.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseMenu, parsePrice, normalizeDigits } from "../src/menu-parse.js";

/** Compact view of a parse: "name|price|category|flags". */
const shape = (text) =>
  parseMenu(text).rows.map((r) =>
    [r.name, r.price, r.category, r.flags.join("+")].join("|")
  );

/* ------------------------------------------------------------------ */
/*  digits                                                             */
/* ------------------------------------------------------------------ */

test("normalizeDigits: Arabic-Indic and Persian digits become ASCII", () => {
  assert.equal(normalizeDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(normalizeDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(normalizeDigits("شاورما ٥٠٠٠"), "شاورما 5000");
  assert.equal(normalizeDigits("mixed ٤2٣"), "mixed 423");
  assert.equal(normalizeDigits(""), "");
  assert.equal(normalizeDigits(null), "");
});

test("parsePrice: group separators, including the Arabic thousands mark", () => {
  assert.equal(parsePrice("15000"), 15000);
  assert.equal(parsePrice("15,000"), 15000);
  assert.equal(parsePrice("15.000"), 15000);   // European style
  assert.equal(parsePrice("15 000"), 15000);
  assert.equal(parsePrice("15٬000"), 15000);   // U+066C Arabic thousands separator
  assert.equal(parsePrice("١٥٬٠٠٠"), 15000);
  assert.equal(parsePrice("٥٠٠٠"), 5000);
  assert.equal(parsePrice("abc"), null);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice(null), null);
});

/* ------------------------------------------------------------------ */
/*  the separator forms named in the brief                             */
/* ------------------------------------------------------------------ */

const SEPARATORS = [
  ["em dash", "اسم الصنف — 15000"],
  ["hyphen", "اسم الصنف - 15000"],
  ["en dash", "اسم الصنف – 15000"],
  ["dot leaders", "اسم الصنف .......... 15,000"],
  ["tab", "اسم الصنف\t15000"],
  ["comma", "اسم الصنف,15000"],
  ["Arabic comma", "اسم الصنف،15000"],
  ["colon", "اسم الصنف: 15000"],
  ["wide gap", "اسم الصنف     15000"],
  ["no separator at all", "اسم الصنف 15000"],
  ["trailing currency", "اسم الصنف — 15000 ل.س"],
  ["Arabic-Indic price", "اسم الصنف — ١٥٠٠٠"]
];

for (const [label, line] of SEPARATORS) {
  test(`separator: ${label}`, () => {
    const { rows } = parseMenu(line);
    assert.equal(rows.length, 1, `expected one row from ${JSON.stringify(line)}`);
    assert.equal(rows[0].name, "اسم الصنف");
    assert.equal(rows[0].price, 15000);
    assert.deepEqual(rows[0].flags, [], "a clean line should carry no flags");
  });
}

/* ------------------------------------------------------------------ */
/*  category headers vs bare items                                     */
/* ------------------------------------------------------------------ */

test("a heading with items under it becomes a category", () => {
  assert.deepEqual(
    shape("المشاوي\nشيش طاووق — 15000\nكباب — 18000"),
    ["شيش طاووق|15000|المشاوي|", "كباب|18000|المشاوي|"]
  );
});

test("a heading ending in a colon is a category even with nothing under it", () => {
  const { rows, headers } = parseMenu("حلويات:\nكنافة — 12000");
  assert.equal(headers.length, 1);
  assert.equal(headers[0].name, "حلويات");
  assert.equal(rows[0].category, "حلويات");
});

test("an underlined title is a heading", () => {
  const { headers, rows } = parseMenu("مطعم الشام\n==========\nحمص — 5000");
  assert.equal(headers[0].name, "مطعم الشام");
  assert.equal(rows.length, 1, "the decoration line must not become an item");
});

/*
 * The ambiguous case the brief describes twice, from both sides: a line with no
 * digits and no separator is either a heading or an item nobody priced. It is
 * resolved by what follows it — a heading has its items directly beneath.
 */
test("a bare line directly above a priced item is a heading", () => {
  const { headers, rows } = parseMenu("المقبلات\nحمص — 5000");
  assert.equal(headers.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "المقبلات");
});

test("a bare line separated by a blank is an unpriced item, not a heading", () => {
  // "مياه معدنية" trailing the drinks list is a real item nobody priced.
  const { headers, rows } = parseMenu("المشروبات\nشاي — 2000\nمياه معدنية\n\nبيتزا — 17000");
  assert.equal(headers.length, 1, "only المشروبات is a heading");
  const water = rows.find((r) => r.name === "مياه معدنية");
  assert.ok(water, "the water should survive as an item");
  assert.equal(water.price, 0);
  assert.deepEqual(water.flags, ["no_price"]);
});

test("a bare line at the very end is an item, not a heading", () => {
  const { rows, headers } = parseMenu("حمص — 5000\nسلطة خضار");
  assert.equal(headers.length, 0, "nothing follows it, so it heads nothing");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, "سلطة خضار");
  assert.deepEqual(rows[1].flags, ["no_price"]);
});

/* ------------------------------------------------------------------ */
/*  prices the parser must not guess at                                */
/* ------------------------------------------------------------------ */

test("an implausibly low price is flagged, never silently multiplied", () => {
  const { rows } = parseMenu(
    "شيش — 15000\nكباب — 18000\nفروج — 20000\nريش — 25000\nبقلاوة — 15"
  );
  const baklava = rows.find((r) => r.name === "بقلاوة");
  assert.equal(baklava.price, 15, "the parsed price must be left exactly as written");
  assert.ok(baklava.flags.includes("implausible_price"));
  assert.equal(baklava.suggestedPrice, 15000, "a suggestion is offered for the admin to accept");

  // And the rows that are obviously fine are not flagged.
  assert.deepEqual(rows.find((r) => r.name === "شيش").flags, []);
});

test("a genuinely cheap item is not flagged just for being cheap", () => {
  // Tea at 500 against a median of 6000 is ordinary, not suspicious.
  const { rows } = parseMenu("حمص — 5000\nفتوش — 6000\nتبولة — 6000\nشاي — 500");
  const tea = rows.find((r) => r.name === "شاي");
  assert.equal(tea.price, 500);
  assert.deepEqual(tea.flags, [], "500 against a 6000 median is plausible");
});

test("too few priced rows to judge means no implausibility flag", () => {
  const { rows } = parseMenu("شيش — 15000\nشاي — 15");
  assert.ok(!rows.some((r) => r.flags.includes("implausible_price")),
    "a median from two rows is not evidence of anything");
});

test("duplicates are flagged but still imported", () => {
  const { rows } = parseMenu("حمص — 5000\nفتوش — 6000\nحمص — 5000");
  assert.equal(rows.length, 3);
  assert.ok(rows[2].flags.includes("duplicate"));
  assert.ok(!rows[0].flags.includes("duplicate"), "the first occurrence is not the duplicate");
});

/* ------------------------------------------------------------------ */
/*  noise                                                              */
/* ------------------------------------------------------------------ */

test("decoration and stray prices are skipped, not turned into items", () => {
  const { rows, skipped } = parseMenu("حمص — 5000\n--------\n15000\n****");
  assert.equal(rows.length, 1);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["decoration", "decoration", "price_without_name"]);
});

test("list markers and numbering are stripped from names", () => {
  assert.deepEqual(shape("• حمص — 5000\n1. فتوش — 6000\n- تبولة — 6000"),
    ["حمص|5000||", "فتوش|6000||", "تبولة|6000||"]);
});

test("a name containing digits keeps them", () => {
  assert.deepEqual(shape("بيتزا 4 مواسم — 17000"), ["بيتزا 4 مواسم|17000||"]);
  assert.deepEqual(shape("كولا 330 مل — 2000"), ["كولا 330 مل|2000||"]);
});

test("a size in the name with no price is an unpriced item", () => {
  // "330 مل" is a volume, not a price, and the parser must not read it as one.
  const { rows } = parseMenu("كولا 330 مل");
  assert.equal(rows[0].name, "كولا 330 مل");
  assert.equal(rows[0].price, 0);
  assert.deepEqual(rows[0].flags, ["no_price"]);
});

test("empty and whitespace input parse to nothing", () => {
  for (const input of ["", "   ", "\n\n\n", null, undefined]) {
    const out = parseMenu(input);
    assert.deepEqual(out.rows, []);
    assert.deepEqual(out.headers, []);
  }
});

/* ------------------------------------------------------------------ */
/*  the whole thing at once                                            */
/* ------------------------------------------------------------------ */

test("a full messy menu, exactly as it would be pasted", () => {
  const pasted = `مطعم الشام
=================

المشاوي
شيش طاووق — 15000
كباب حلبي - 18000
ريش غنم .......... 25,000
فروج مشوي	20000
شقف لحمة,22000

المقبلات
حمص ٥٠٠٠
متبل ٥٬٥٠٠
فتوش   6000
تبولة — ٦٠٠٠
سلطة خضار

المشروبات
كولا 330 مل — 2000
شاي — 500
عصير ليمون — 3.000
مياه معدنية

حلويات:
كنافة — 12000
بقلاوة — 15`;

  const { rows, headers, stats } = parseMenu(pasted);

  assert.deepEqual(headers.map((h) => h.name),
    ["مطعم الشام", "المشاوي", "المقبلات", "المشروبات", "حلويات"]);

  assert.deepEqual(shape(pasted), [
    "شيش طاووق|15000|المشاوي|",
    "كباب حلبي|18000|المشاوي|",
    "ريش غنم|25000|المشاوي|",
    "فروج مشوي|20000|المشاوي|",
    "شقف لحمة|22000|المشاوي|",
    "حمص|5000|المقبلات|",
    "متبل|5500|المقبلات|",
    "فتوش|6000|المقبلات|",
    "تبولة|6000|المقبلات|",
    "سلطة خضار|0|المقبلات|no_price",
    "كولا 330 مل|2000|المشروبات|",
    "شاي|500|المشروبات|",
    "عصير ليمون|3000|المشروبات|",
    "مياه معدنية|0|المشروبات|no_price",
    "كنافة|12000|حلويات|",
    "بقلاوة|15|حلويات|implausible_price"
  ]);

  assert.equal(stats.items, 16);
  assert.equal(stats.flagged, 3);
  assert.equal(rows.every((r) => Number.isInteger(r.price)), true,
    "every price must be a whole number — no floats reach the money path");
});

test("an English menu parses too — the parser is not Arabic-only", () => {
  assert.deepEqual(shape("Grills\nChicken Shish — 15000\nLamb Chops ..... 25,000"),
    ["Chicken Shish|15000|Grills|", "Lamb Chops|25000|Grills|"]);
});

/*
 * Regression: the currency stripper used to match the Latin abbreviations
 * anywhere at the end of a line, so any word ending in "ls" or "sp" lost its
 * last two letters — "Grills" became "Gril", "Crisp" became "Cri". A currency
 * mark only counts after a digit or a space.
 */
test("names ending in letters that look like currency codes survive intact", () => {
  const names = [
    "Grills", "Spring Rolls", "Crisp", "Falafel Balls", "Meatballs",
    "Chips", "Wasp Honey", "Syrup"
  ];
  for (const name of names) {
    const { rows } = parseMenu(`${name} — 15000`);
    assert.equal(rows[0].name, name, `"${name}" must not be truncated`);
    assert.equal(rows[0].price, 15000);
  }
});

test("a real currency mark after the price is still stripped", () => {
  for (const line of [
    "شاورما — 15000 ل.س", "شاورما — 15000ل.س", "شاورma — 15000 SYP",
    "شاورما — 15000 LS", "شاورما — 15000 ليرة سورية"
  ]) {
    const { rows } = parseMenu(line);
    assert.equal(rows[0].price, 15000, `price should survive in ${JSON.stringify(line)}`);
    assert.ok(!/SYP|LS|ل\.س|ليرة/i.test(rows[0].name),
      `currency should not be left in the name: got ${JSON.stringify(rows[0].name)}`);
  }
});
