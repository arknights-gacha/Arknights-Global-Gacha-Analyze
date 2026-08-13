#!/usr/bin/env node
//
// Locale linter. Run:  node functions/lint-locales.js [--strict]
//
// zh-tw.json is the source of truth; zh-cn.json is its Traditional->Simplified
// counterpart. en-us/ja-jp are checked against zh-tw for content that was
// abridged away rather than translated (dropped clauses, links, list items).
//
// Exits non-zero on ERROR. Warnings print but exit 0 unless --strict is passed.

const fs = require('fs');
const path = require('path');

const LOCALES = ['zh-tw', 'zh-cn', 'en-us', 'ja-jp'];
const SOURCE = 'zh-tw';
const LOCALE_DIR = path.join(__dirname, 'locales');
const VIEW_DIR = path.join(__dirname, 'views');

// A healthy translation of dense Chinese runs longer in English, roughly par in
// Japanese. Well below these means content was dropped, not condensed.
const MIN_RATIO = { 'en-us': 1.5, 'ja-jp': 0.85 };
// Short labels ("Login", "Star") have meaningless ratios.
const RATIO_MIN_SOURCE_LEN = 40;

// Ratios must compare prose, not incidental characters. Markup and URLs are
// identical in every locale, so leaving them in deflates the ratio of any string
// carrying a link and produces false "abridged" reports.
const proseLen = (s) => s
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/&[a-z]+;/g, '')
    .trim().length;

// zh-tw headings follow a bilingual convention — "隱私權政策 (Privacy Policy)" —
// where the parenthesised English gloss exists only in the Chinese. Counting it
// makes every correctly-translated heading look truncated, so strip it from the
// source side only.
const stripGloss = (s) => s.replace(/[（(][A-Za-z0-9 &'.,\/-]+[)）]/g, '').trim();

const TAG_PATTERNS = {
    '<a href': /<a\s+href/g,
    '<br>': /<br\s*\/?>/g,
    '<strong>': /<strong>/g,
    '<code>': /<code>/g,
    'bullet': /•/g
};

const findings = [];
const add = (severity, key, detail) => findings.push({ severity, key, detail });

// ---------------------------------------------------------------- load locales
const data = {};
for (const loc of LOCALES) {
    const file = path.join(LOCALE_DIR, `${loc}.json`);
    try {
        data[loc] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`FATAL  cannot read/parse ${loc}.json: ${e.message}`);
        process.exit(2);
    }
}

// ------------------------------------------------------------- key-set drift
const sourceKeys = Object.keys(data[SOURCE]);
for (const loc of LOCALES) {
    if (loc === SOURCE) continue;
    for (const k of sourceKeys) {
        if (!(k in data[loc])) add('ERROR', k, `missing from ${loc}.json`);
    }
    for (const k of Object.keys(data[loc])) {
        if (!(k in data[SOURCE])) add('ERROR', k, `present in ${loc}.json but not in ${SOURCE}.json`);
    }
}

// ------------------------------- scan views for t() usage and render mode
// Derived at lint time rather than hardcoded so it cannot drift from the views.
// A key escaped in ANY view is escaped-constrained everywhere, since the same
// string is reused across render sites.
const viewFiles = [];
for (const dir of [VIEW_DIR, path.join(VIEW_DIR, 'partials')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.ejs')) viewFiles.push(path.join(dir, f));
    }
}

const rawKeys = new Set();
const escapedKeys = new Set();
const referenced = new Set();

for (const file of viewFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<%(=|-)\s*t\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        referenced.add(m[2]);
        (m[1] === '-' ? rawKeys : escapedKeys).add(m[2]);
    }
    // t('key') inside scriptlets/template literals — the surrounding tag decides
    // escaping, so record the reference but do not classify the render mode.
    for (const m of src.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g)) referenced.add(m[1]);
}

// Server-side t() calls (res.locals.t('...')) in the function entrypoint.
for (const f of ['index.js']) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g)) referenced.add(m[1]);
}

// --------------------------------------- HTML in keys that are always escaped
const HTML_RE = /<[a-zA-Z/][^>]*>/;
for (const loc of LOCALES) {
    for (const k of Object.keys(data[loc])) {
        if (!HTML_RE.test(data[loc][k])) continue;
        if (escapedKeys.has(k) && !rawKeys.has(k)) {
            add('ERROR', k, `${loc}: contains HTML but is rendered escaped (<%=) — it will display as literal text`);
        }
    }
}

// ------------------- main_heading is injected raw into a JSON-LD string literal
for (const loc of LOCALES) {
    const v = data[loc].main_heading;
    if (v === undefined) continue;
    if (/["\\<]/.test(v)) {
        add('ERROR', 'main_heading', `${loc}: contains " \\ or < — breaks the JSON-LD block in partials/seo-head.ejs`);
    }
}

// --------------------------------------------- markup dropped relative to zh-tw
for (const k of sourceKeys) {
    for (const [label, re] of Object.entries(TAG_PATTERNS)) {
        const want = (data[SOURCE][k].match(re) || []).length;
        if (want === 0) continue;
        for (const loc of ['en-us', 'ja-jp']) {
            const got = (data[loc][k].match(re) || []).length;
            if (got < want) add('WARN', k, `${loc}: has ${got} "${label}" vs ${want} in ${SOURCE} — markup/content dropped`);
        }
    }
}

// ------------------------------------------------------- length-ratio outliers
for (const k of sourceKeys) {
    const srcLen = proseLen(stripGloss(data[SOURCE][k]));
    if (srcLen <= RATIO_MIN_SOURCE_LEN) continue;
    for (const loc of ['en-us', 'ja-jp']) {
        const locLen = proseLen(data[loc][k]);
        const ratio = locLen / srcLen;
        if (ratio < MIN_RATIO[loc]) {
            add('WARN', k, `${loc}: prose ratio ${ratio.toFixed(2)} < ${MIN_RATIO[loc]} (${locLen} vs ${srcLen} prose chars) — likely abridged`);
        }
    }
}

// ---------------------------------------------------------- unreferenced keys
for (const k of sourceKeys) {
    if (!referenced.has(k)) add('INFO', k, 'not referenced by any view or index.js');
}

// ----------------------------------------------------------------- report out
const order = { ERROR: 0, WARN: 1, INFO: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.key.localeCompare(b.key));

const counts = { ERROR: 0, WARN: 0, INFO: 0 };
for (const f of findings) counts[f.severity]++;

for (const f of findings) {
    console.log(`${f.severity.padEnd(5)}  ${f.key.padEnd(26)}  ${f.detail}`);
}
if (findings.length) console.log('');
console.log(`${counts.ERROR} error(s), ${counts.WARN} warning(s), ${counts.INFO} info`);

if (counts.ERROR > 0) process.exit(1);
if (process.argv.includes('--strict') && counts.WARN > 0) process.exit(1);
