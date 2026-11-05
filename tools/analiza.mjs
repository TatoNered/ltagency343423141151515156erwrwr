#!/usr/bin/env node
/* Анализ текстов: плотность ключей, классическая и академическая тошнота,
   длина, читаемость, повторы. Работает по собранным страницам в dist/.

   node tools/analiza.mjs            — отчёт по всем страницам
   node tools/analiza.mjs /cene/     — по одной странице
   node tools/analiza.mjs --csv      — выгрузка в CSV

   Нормы (классика русского SEO, применимы и к сербскому):
     классическая тошнота   <= 7          (sqrt от числа повторов самого частого слова)
     академическая тошнота  4--8 %        (доля самого частого слова от всех слов)
     плотность фразы        1.5--3 %      (выше — переспам)
     вода                   <= 60 %       (доля стоп-слов)
*/
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

/* Стоп-слова: сербский + русский + английский. Для «воды». */
const STOP = new Set(`
a i ili ali pa te da je su sam si smo ste bi bih bismo biste bio bila bilo budu
se ne ni niti nego već samo tek još uvek sve svi sva svaki svaka svako neki neka neko
u na za od do iz sa sa s o po pri pre posle kroz nad pod uz bez oko među prema radi
ovaj ova ovo taj ta to onaj ona ono ovde tamo gde kada kako zašto šta ko koji koja koje
mi vi oni ja ti on ona ono nas vas njih nam vam njima me te ga je ih
što li ako jer dok čim nakon zatim onda tako takođe isto dakle naime
ima imati biti može mogu moći treba trebati hoće hoću želi
vrlo mnogo malo više manje najviše najmanje dosta previše
svoj svoja svoje naš naša naše vaš vaša vaše njegov njen njihov
jedan jedna jedno dva tri jednom dvaput
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне
было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до
вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя
их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого
какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда
можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая
много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им
более всегда конечно всю между это как бы
the a an and or but if then of to in on at for with by from as is are was were be been being
this that these those it its we you they he she i not no yes do does did have has had will would
can could should may might must about into over under more most less least very just only also
`.trim().split(/\s+/));

const PAGES_ORDER = ["/", "/usluge/", "/cene/", "/besplatna-analiza/", "/rezultati/", "/o-nama/", "/o-nama/tim/", "/kontakt/"];

function walkHtml(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkHtml(p, acc);
    else if (e === "index.html") acc.push(p);
  }
  return acc;
}

/* видимый текст статьи: из <main>, без скриптов и навигации */
function visibleText(html) {
  let m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let s = m ? m[1] : html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "")
       .replace(/<style[\s\S]*?<\/style>/gi, "")
       .replace(/<nav[\s\S]*?<\/nav>/gi, "")
       .replace(/<aside class="cta"[\s\S]*?<\/aside>/gi, "")
       .replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&middot;|&mdash;/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

const words = t => (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1);

function phraseCount(text, phrase) {
  const p = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  const w = words(text);
  let n = 0;
  for (let i = 0; i + p.length <= w.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length; j++) {
      // сопоставление по основе: сербский склоняется, точное совпадение занижает счёт
      const stem = p[j].slice(0, Math.max(4, p[j].length - 2));
      if (!w[i + j].startsWith(stem)) { ok = false; break; }
    }
    if (ok) n++;
  }
  return n;
}

function analyze(file) {
  const html = readFileSync(file, "utf8");
  const url = "/" + file.replace(DIST, "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/index\.html$/, "");
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const desc = (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || "";
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)];
  const imgsNoAlt = imgs.filter(m => !/\balt="[^"]+"/i.test(m[0])).length;

  const text = visibleText(html);
  const w = words(text);
  const total = w.length;

  const freq = new Map();
  for (const x of w) freq.set(x, (freq.get(x) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  // значимые слова — без стоп-листа
  const sig = sorted.filter(([x]) => !STOP.has(x));
  const topRep = sig.length ? sig[0][1] : 0;

  const classic = +Math.sqrt(topRep).toFixed(2);
  const academic = total ? +((topRep / total) * 100).toFixed(2) : 0;
  const stopCount = w.filter(x => STOP.has(x)).length;
  const water = total ? +((stopCount / total) * 100).toFixed(1) : 0;

  // предложения и читаемость
  const sentences = text.split(/[.!?]+(?:\s|$)/).map(s => s.trim()).filter(s => s.split(/\s+/).length > 2);
  const avgSent = sentences.length ? +(total / sentences.length).toFixed(1) : 0;
  const longSent = sentences.filter(s => s.split(/\s+/).length > 30).length;

  return { url, file, title, desc, h1s, h2s, imgs: imgs.length, imgsNoAlt, text, total, sorted, sig, classic, academic, water, avgSent, longSent, sentences: sentences.length };
}

/* ключевые фразы по страницам — из семантического ядра */
const TARGETS = {
  "/": ["izrada sajta", "seo optimizacija", "beograd", "sajt"],
  "/cene/": ["cena", "seo optimizacija", "izrada sajta", "paket"],
  "/usluge/": ["usluga", "izrada sajtova", "seo optimizacija"],
  "/usluge/seo-optimizacija/": ["seo optimizacija", "pretraga", "sajt", "beograd"],
  "/usluge/izrada-sajtova/": ["izrada sajta", "sajt", "strana", "beograd"],
  "/usluge/google-business-profil/": ["google profil", "recenzije", "mape", "firma"],
  "/usluge/izrada-internet-prodavnice/": ["internet prodavnica", "katalog", "proizvod"],
  "/besplatna-analiza/": ["analiza", "sajt"],
  "/rezultati/": ["rezultat", "klijent", "sajt"],
  "/o-nama/": ["agencija", "beograd", "firma"],
  "/lokacije/zemun/": ["zemun", "sajt", "pretraga"],
  "/lokacije/novi-beograd/": ["novi beograd", "pretraga", "firma"],
  "/lokacije/vozdovac/": ["voždovac", "posao", "strana"],
  "/lokacije/zvezdara/": ["zvezdara", "profil", "recenzije"],
  "/industrije/zanatlije-i-majstori/": ["majstor", "google profil", "porudžbina"],
  "/industrije/nekretnine/": ["agencija", "portal", "upit"],
  "/industrije/auto-skole/": ["auto škola", "polaznik", "recenzije"],
  "/industrije/bezbednosni-sistemi/": ["video nadzor", "alarm", "interfon"],
  "/industrije/namestaj-i-enterijer/": ["nameštaj", "katalog", "po meri"],
  "/industrije/nega-i-zdravstvo/": ["nega", "porodica", "cena"],
  "/blog/koliko-kosta-seo-u-srbiji/": ["cena", "seo optimizacija", "mesečno"],
  "/blog/kako-izabrati-seo-agenciju/": ["agencija", "izvođač", "pitanje"],
  "/blog/zasto-sajt-nije-na-google/": ["sajt", "google", "strana"],
  "/blog/seo-ili-google-oglasi/": ["oglasi", "seo", "upit"],
  "/blog/garancija-prve-pozicije/": ["garancija", "pozicija", "fraza"],
  "/blog/kako-dobiti-vise-google-recenzija/": ["recenzije", "profil", "klijent"],
  "/usluge/odrzavanje-sajta/": ["održavanje", "sajt", "mesečno"],
  "/usluge/google-ads/": ["oglasi", "budžet", "kampanja"],
  "/usluge/ai-vidljivost/": ["ai pretraga", "sajt", "odgovor"],
  "/kontakt/": ["kontakt", "beograd"]
};

function verdict(v, lo, hi) {
  if (v < lo) return ["низко", "\x1b[33m"];
  if (v > hi) return ["ВЫСОКО", "\x1b[31m"];
  return ["норма", "\x1b[32m"];
}
const R = "\x1b[0m", B = "\x1b[1m", D = "\x1b[2m";

if (!existsSync(DIST)) { console.error("Нет dist/. Сначала: node build.mjs"); process.exit(1); }

const args = process.argv.slice(2);
const only = args.find(a => a.startsWith("/"));
const csv = args.includes("--csv");

let all = walkHtml(DIST).map(analyze);
all.sort((a, b) => (PAGES_ORDER.indexOf(a.url) + 99 * (PAGES_ORDER.indexOf(a.url) < 0)) - (PAGES_ORDER.indexOf(b.url) + 99 * (PAGES_ORDER.indexOf(b.url) < 0)));
if (only) all = all.filter(p => p.url === only);

if (csv) {
  const rows = [["url", "slov", "klasicna", "akademska", "voda", "avg_recenica", "title_len", "desc_len", "h1", "h2"]];
  for (const p of all) rows.push([p.url, p.total, p.classic, p.academic, p.water, p.avgSent, p.title.length, p.desc.length, p.h1s.length, p.h2s.length]);
  console.log(rows.map(r => r.join(";")).join("\n"));
  process.exit(0);
}

let problems = 0;
console.log(`\n${B}АНАЛИЗ ТЕКСТОВ${R}  ${D}${all.length} страниц${R}\n${"─".repeat(76)}`);

for (const p of all) {
  console.log(`\n${B}${p.url}${R}`);

  // мета
  const tl = p.title.length, dl = p.desc.length;
  const tOk = tl >= 35 && tl <= 60, dOk = dl >= 120 && dl <= 160;
  if (!tOk) problems++;
  if (!dOk) problems++;
  console.log(`  title  ${tOk ? "\x1b[32m" : "\x1b[31m"}${tl}${R} симв. ${tOk ? "" : "(норма 35–60)"}  ${D}${p.title.slice(0, 64)}${R}`);
  console.log(`  descr  ${dOk ? "\x1b[32m" : "\x1b[31m"}${dl}${R} симв. ${dOk ? "" : "(норма 120–160)"}`);

  // структура
  const h1ok = p.h1s.length === 1;
  if (!h1ok) problems++;
  console.log(`  h1 ${h1ok ? "\x1b[32m1\x1b[0m" : `\x1b[31m${p.h1s.length}\x1b[0m`}   h2 ${p.h2s.length}   ${p.imgsNoAlt ? `\x1b[31mкартинок без alt: ${p.imgsNoAlt}\x1b[0m` : `${D}картинок ${p.imgs}${R}`}`);

  // Порог объёма по типу страницы: 404 и контакты короткие по своей природе,
  // ветки /ru/ и /en/ намеренно сжатые — полным зеркалом они и не должны быть.
  const raw = readFileSync(p.file, "utf8");
  const isNoindex = /<meta name="robots" content="noindex/.test(raw);
  const isDeclaredShort = /<body[^>]*\bclass="[^"]*\bshort\b/.test(raw);
  const isShortByNature = /\/(kontakt|contact)\/$/.test(p.url) || p.url === "/o-nama/tim/";
  const isSecondary = /^\/(ru|en)\//.test(p.url);
  const minWords = isNoindex ? 0 : isDeclaredShort ? 120 : isShortByNature ? 100 : isSecondary ? 150 : p.url === "/usluge/" ? 200 : 350;
  const volOk = p.total >= minWords;
  if (!volOk) problems++;
  console.log(`  объём  ${volOk ? "\x1b[32m" : "\x1b[33m"}${p.total}${R} слов, ${p.sentences} предл., в среднем ${p.avgSent} слов${p.longSent ? `, ${D}длинных (>30): ${p.longSent}${R}` : ""}`);

  // тошнота
  // Низкая тошнота — это хорошо, а не недостаток: границей считается только верх.
  const [cv, cc] = verdict(p.classic, 0, 7);
  const [av, ac] = verdict(p.academic, 0, 8);
  const [wv, wc] = verdict(p.water, 0, 60);
  if (cv === "ВЫСОКО" || av === "ВЫСОКО" || wv === "ВЫСОКО") problems++;
  console.log(`  тошнота классическая ${cc}${p.classic}${R} (${cv}, ≤7)   академическая ${ac}${p.academic}%${R} (${av}, ≤8%)   вода ${wc}${p.water}%${R} (${wv}, ≤60%)`);

  // топ слов
  console.log(`  частые: ${D}${p.sig.slice(0, 8).map(([x, n]) => `${x}·${n}`).join("  ")}${R}`);

  // ключевые фразы
  const tg = TARGETS[p.url];
  if (tg) {
    const line = tg.map(ph => {
      const n = phraseCount(p.text, ph);
      const dens = p.total ? (n * ph.split(/\s+/).length / p.total) * 100 : 0;
      const ok = dens >= 0.5 && dens <= 3.2;
      if (!ok && dens > 3.2) problems++;
      return `${ok ? "\x1b[32m" : dens > 3.2 ? "\x1b[31m" : "\x1b[33m"}${ph}${R} ${n}×/${dens.toFixed(2)}%`;
    }).join("   ");
    console.log(`  ключи:  ${line}`);
  }
}

console.log(`\n${"─".repeat(76)}`);
console.log(problems === 0
  ? `${B}\x1b[32mВсё в норме.${R}`
  : `${B}Замечаний: ${problems}.${R} Красное — править, жёлтое — посмотреть.`);
console.log(`${D}Плотность ключа: норма 0.5–3.2%. Выше — переспам, ниже — фраза не закреплена.${R}\n`);
