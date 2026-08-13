const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const express = require('express');
const multer = require('multer');
const path = require('path');
const { 
    getUid, 
    fetchGachaTypes,
    fetchVisitLogPage,
    fetchAllLogsSlowly, 
    mergeLogs, 
    analyzeLogs 
} = require('./utils');

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Trust proxy for Firebase Hosting
app.set('trust proxy', 1);

const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  // English by default: the limiter is built at module load, before the i18n
  // middleware exists, so res.locals.t is unavailable here.
  message: 'Too many requests. Please try again later.'
});
app.use(limiter);

app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public'))); // Serving CSS logic


// Basic session using a cookie (cookie-parser and basic token can be better, but we will use a simple UID cookie for this example app to replace Flask Session)
const cookieParser = require('cookie-parser');
app.use(cookieParser('firebase-arknights-secret'));

// i18n Middleware
const fs = require('fs');
const locales = {
    'zh-tw': JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/zh-tw.json'), 'utf8')),
    'zh-cn': JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/zh-cn.json'), 'utf8')),
    'en-us': JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/en-us.json'), 'utf8')),
    'ja-jp': JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/ja-jp.json'), 'utf8'))
};

// Locale routing constants. English is the default for every visitor whose
// browser language is not Chinese, Japanese or English (ko, fr, de, ...).
const SUPPORTED_LOCALES = Object.keys(locales); // ['zh-tw', 'zh-cn', 'en-us', 'ja-jp']
const DEFAULT_LOCALE = 'en-us';
const HREFLANG_MAP = { 'zh-tw': 'zh-Hant', 'zh-cn': 'zh-Hans', 'en-us': 'en', 'ja-jp': 'ja' };
const LOCALE_PATH_RE = new RegExp(`^/(${SUPPORTED_LOCALES.join('|')})(?:/|$)`);

// Membership test via the array, not `locales[x]` — a bare object lookup would
// treat inherited names like "constructor" as a valid locale.
const isLocale = (l) => SUPPORTED_LOCALES.includes(l);

// [CRITICAL] Firebase Hosting rewrites the Host header to the Cloud Run service
// URL before the request reaches this function, so in production req.get('host')
// is always app-xxxx.a.run.app and never the real domain. Anything that declares
// the site's identity to the outside world — canonical, hreflang, og:url,
// JSON-LD, sitemap — must come from here rather than from the request, otherwise
// we tell Google the authoritative copy lives on run.app.
// The emulator passes the real host through, which is why this is invisible locally.
const CANONICAL_ORIGIN = process.env.CANONICAL_ORIGIN || 'https://arknights-gacha.web.app';
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Local dev keeps the request host so emulator links stay clickable.
function resolveOrigin(req) {
    const host = req.get('host') || '';
    if (LOCAL_HOST_RE.test(host)) {
        return `${req.get('x-forwarded-proto') || req.protocol}://${host}`;
    }
    return CANONICAL_ORIGIN;
}

// Resolve a locale from the browser's Accept-Language header.
// Anything unrecognized falls back to English.
function detectLocaleFromHeaders(req) {
    // Firebase Hosting normalizes Accept-Language down to base language codes
    // (zh-TW -> zh) but preserves the original in x-orig-accept-language. Without
    // restoring it, Traditional and Simplified Chinese are indistinguishable and
    // every Chinese visitor lands on zh-cn.
    //
    // This header is sent BY Hosting — the app neither sets nor should set it.
    // Do not "prove" it unused by grepping the repo for who assigns it and delete
    // this block; that mistake shipped once already. Verify by what arrives at the
    // function in production, which the emulator cannot show you (it forwards the
    // real Accept-Language untouched).
    if (req.headers['x-orig-accept-language']) {
        req.headers['accept-language'] = req.headers['x-orig-accept-language'];
    }

    const acceptedLangs = req.acceptsLanguages();
    if (acceptedLangs && acceptedLangs.length > 0) {
        for (let accepted of acceptedLangs) {
            const lower = accepted.toLowerCase();
            if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-hant')) {
                return 'zh-tw';
            } else if (lower.startsWith('zh-cn') || lower.startsWith('zh-sg') || lower.startsWith('zh-hans') || lower === 'zh') {
                return 'zh-cn';
            } else if (lower.startsWith('ja')) {
                return 'ja-jp';
            } else if (lower.startsWith('en')) {
                return 'en-us';
            }
        }
    }
    return DEFAULT_LOCALE;
}

// Sitemap listing every indexable page x locale, with hreflang alternates per
// Google's sitemap format. The home page is excluded on purpose: it requires an
// auth cookie, so anonymous crawlers only ever get redirected to /login there.
//
// Registered BEFORE the i18n middleware on purpose. That middleware sets a `lang`
// cookie on every request, and Set-Cookie forces `Cache-Control: private` plus
// `Vary: cookie`, which stops the CDN caching this and makes every crawler fetch
// spin up a function. This route needs none of it: it only uses resolveOrigin()
// and module-level constants, never res.locals.
app.get('/sitemap.xml', (req, res) => {
    const origin = resolveOrigin(req);
    const pages = [
        { slug: 'login', changefreq: 'weekly', priority: '1.0' },
        { slug: 'privacy', changefreq: 'yearly', priority: '0.3' }
    ];

    const entries = [];
    for (const page of pages) {
        for (const lang of SUPPORTED_LOCALES) {
            const alternates = SUPPORTED_LOCALES.map(l =>
                `    <xhtml:link rel="alternate" hreflang="${HREFLANG_MAP[l]}" href="${origin}/${l}/${page.slug}"/>`
            ).join('\n');
            entries.push(
`  <url>
    <loc>${origin}/${lang}/${page.slug}</loc>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}/${DEFAULT_LOCALE}/${page.slug}"/>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`);
        }
    }

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`);
});

// Legacy ?lang=xx URLs permanently moved to /xx/ paths. 301 (not 302) because this
// mapping is fixed and 1:1, so any indexing signal consolidates onto the new URL.
// GET only: a 301 on POST would drop the request body.
app.use((req, res, next) => {
    const legacyLang = req.query.lang;
    if (req.method === 'GET' && isLocale(legacyLang) && !LOCALE_PATH_RE.test(req.path)) {
        const rest = { ...req.query };
        delete rest.lang;
        const qs = new URLSearchParams(rest).toString();
        const target = `/${legacyLang}${req.path === '/' ? '/' : req.path}${qs ? '?' + qs : ''}`;
        return res.redirect(301, target);
    }
    next();
});

// i18n middleware. Locale priority: URL path prefix -> lang cookie -> Accept-Language -> English.
app.use((req, res, next) => {
    const pathMatch = req.path.match(LOCALE_PATH_RE);
    let lang;

    if (pathMatch) {
        lang = pathMatch[1]; // the path is authoritative whenever it carries a locale
    } else if (req.body && isLocale(req.body.lang)) {
        // Form posts hit the locale-agnostic /login, so they carry the locale of the
        // page they were submitted from. This matters because Firebase Hosting strips
        // every cookie except __session, so the lang cookie below never survives in
        // production — without this, POST /login would fall back to Accept-Language
        // and bounce the user out of the language they had chosen.
        lang = req.body.lang;
    } else if (isLocale(req.cookies.lang)) {
        lang = req.cookies.lang;
    } else {
        lang = detectLocaleFromHeaders(req);
    }

    res.cookie('lang', lang, { maxAge: 31536000000, httpOnly: true }); // 1 year

    res.locals.lang = lang;

    res.locals.origin = resolveOrigin(req);

    // Exposed for the seo-head / lang-switcher partials
    res.locals.supportedLocales = SUPPORTED_LOCALES;
    res.locals.hreflangMap = HREFLANG_MAP;
    res.locals.defaultLocale = DEFAULT_LOCALE;
    // Safety net: the partials dereference `page`, so a res.render() that forgets
    // to pass it would throw and 500 the page. Render options override res.locals,
    // so real values still win; this only prevents the crash.
    res.locals.page = '';

    res.locals.t = (key) => {
        let val = locales[lang][key];
        if (val !== undefined) return val;
        // Fall back to English, never to Chinese: a missing key must not inject
        // Traditional Chinese text into an English or Japanese page.
        val = locales[DEFAULT_LOCALE][key];
        return val !== undefined ? val : key;
    };
    next();
});

// Bare paths redirect to the visitor's locale. 302 (not 301) because the target
// depends on their cookie/Accept-Language and can legitimately change between
// visits; a 301 would let browsers cache one locale forever and would discourage
// search engines from discovering the other language versions.
app.get('/', (req, res) => res.redirect(302, `/${res.locals.lang}/`));
app.get('/login', (req, res) => res.redirect(302, `/${res.locals.lang}/login`));
app.get('/privacy', (req, res) => res.redirect(302, `/${res.locals.lang}/privacy`));

const homePaths = SUPPORTED_LOCALES.map(l => `/${l}`);
const loginPaths = SUPPORTED_LOCALES.map(l => `/${l}/login`);
const privacyPaths = SUPPORTED_LOCALES.map(l => `/${l}/privacy`);

app.get(homePaths, async (req, res) => {
    const uid = req.signedCookies.__session;
    if (!uid) {
        return res.redirect(`/${res.locals.lang}/login`);
    }

    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return res.redirect(`/${res.locals.lang}/login`);
        }

        let info = userDoc.data().info || {};
        let nickname = info.nickname || info.nickName || uid;

        const logsDoc = await db.collection('users').doc(uid).collection('data').doc('logs').get();
        let logs = [];
        if (logsDoc.exists) {
            const data = logsDoc.data();
            logs = data.jsonString ? JSON.parse(data.jsonString) : (data.records || []);
        }

        // Analyze logs to plot and interval markup
        const analyzed = analyzeLogs(logs);

        res.render('index', {
            logs: analyzed.logs,
            stats: analyzed,
            nickname: nickname,
            uid: uid,
            page: ''
        });
    } catch (e) {
        console.error(e);
        res.render('login', { flash: res.locals.t('err_load_failed'), page: 'login' });
    }
});

app.get(loginPaths, (req, res) => {
    res.render('login', { flash: null, page: 'login' });
});

app.get(privacyPaths, (req, res) => {
    res.render('privacy', { page: 'privacy' });
});

app.post('/login', async (req, res) => {
    const method = req.body.method;
    
    try {
        if (method === 'cookie') {
            const yssid = req.body.yssid.trim().replace(/[\r\n]+/g, '');
            const yssidSig = req.body.yssidSig.trim().replace(/[\r\n]+/g, '');
            const server = req.body.server || 'jp';
            
            const [uid, infoData] = await getUid(yssid, yssidSig, server);
            console.log(`UID: ${uid}, Server: ${server}`);
            
            let logs = await fetchAllLogsSlowly(uid, yssid, yssidSig, server);
            console.log(`Fetched ${logs.length} logs`);
            
            const logsDocRef = db.collection('users').doc(uid).collection('data').doc('logs');
            const logsDoc = await logsDocRef.get();
            if (logsDoc.exists) {
                const data = logsDoc.data();
                let existing = data.jsonString ? JSON.parse(data.jsonString) : (data.records || []);
                existing.sort((a, b) => b.at - a.at);
                logs.sort((a, b) => b.at - a.at);
                logs = mergeLogs(logs, existing);
            }
            
            // Save to Firestore
            await db.collection('users').doc(uid).set({ info: infoData }, { merge: true });
            
            // For large logs, they shouldn't exceed 1MB in a single document representing roughly 10k pulls.
            // Using JSON.stringify bypasses Firestore's massive per-object array overhead.
            await logsDocRef.set({ jsonString: JSON.stringify(logs) });
            
            res.cookie('__session', uid, { signed: true, httpOnly: true });
            return res.redirect(`/${res.locals.lang}/`);
        } else if (method === 'existing') {
            const uid = req.body.uid;
            const userDoc = await db.collection('users').doc(uid).get();
            if (userDoc.exists) {
                res.cookie('__session', uid, { signed: true, httpOnly: true });
                return res.redirect(`/${res.locals.lang}/`);
            } else {
                return res.render('login', { flash: res.locals.t('err_uid_not_found'), page: 'login' });
            }
        } else if (method === 'app_sync') {
            const uid = req.body.uid;
            let logs = req.body.logs;
            if (typeof logs === 'string') {
                try { logs = JSON.parse(logs); } catch(e) { console.error("Failed to parse logs", e); }
            }
            if (!uid || uid.length < 5 || isNaN(uid)) {
                return res.status(400).send(res.locals.t('err_invalid_uid'));
            }
            if (logs && Array.isArray(logs)) {
                // Ensure logs are sorted chronologically descending before merging
                logs.sort((a, b) => b.at - a.at);
                
                const logsDocRef = db.collection('users').doc(uid).collection('data').doc('logs');
                const logsDoc = await logsDocRef.get();
                if (logsDoc.exists) {
                    const data = logsDoc.data();
                    let existing = data.jsonString ? JSON.parse(data.jsonString) : (data.records || []);
                    existing.sort((a, b) => b.at - a.at);
                    logs = mergeLogs(logs, existing);
                }
                await db.collection('users').doc(uid).set({ info: { uid: uid, nickName: uid } }, { merge: true });
                await logsDocRef.set({ jsonString: JSON.stringify(logs) });
                
                res.cookie('__session', uid, { signed: true, httpOnly: true });
                return res.redirect(`/${res.locals.lang}/`);
            } else {
                return res.status(400).send(res.locals.t('err_bad_payload'));
            }
        } else if (method === 'upload') {
            const uid = req.body.uid;
            let logs = req.body.logs;
            if (typeof logs === 'string') {
                try { logs = JSON.parse(logs); } catch(e) { console.error("Failed to parse logs", e); }
            }
            if (!uid || uid.length < 5 || isNaN(uid)) {
                return res.status(400).send(res.locals.t('err_invalid_uid'));
            }
            if (logs && Array.isArray(logs)) {
                const logsDocRef = db.collection('users').doc(uid).collection('data').doc('logs');
                await db.collection('users').doc(uid).set({ info: { uid: uid, nickName: uid } }, { merge: true });
                await logsDocRef.set({ jsonString: JSON.stringify(logs) });
                
                res.cookie('__session', uid, { signed: true, httpOnly: true });
                return res.redirect(`/${res.locals.lang}/`);
            } else {
                return res.status(400).send(res.locals.t('err_bad_payload'));
            }
        }
    } catch (e) {
        console.error(e);
        return res.render('login', { flash: e.toString(), page: 'login' });
    }
});

app.get('/export', async (req, res) => {
    const uid = req.signedCookies.__session;
    if (!uid) {
        return res.redirect(`/${res.locals.lang}/login`);
    }
    try {
        const logsDoc = await db.collection('users').doc(uid).collection('data').doc('logs').get();
        if (!logsDoc.exists) {
            return res.status(404).send('No logs found.');
        }
        const data = logsDoc.data();
        const logs = data.jsonString ? JSON.parse(data.jsonString) : (data.records || []);
        res.setHeader('Content-disposition', `attachment; filename=visit_logs_${uid}.json`);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(logs, null, 2));
    } catch (e) {
        console.error(e);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('__session');
    res.redirect(`/${res.locals.lang}/login`);
});

// Export the Express app as a Firebase Function (HTTP), set region to US and restrict maxInstances for cost control
exports.app = onRequest({ region: "us-central1", invoker: "public", maxInstances: 20, concurrency: 40, memory: "256MiB" }, app);
