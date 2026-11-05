#!/usr/bin/env node
// Statički generator bez ijedne spoljne zavisnosti.
// Pokretanje:  node build.mjs        -> gradi sajt u dist/
//              node build.mjs --serve -> gradi i diže lokalni server na 8080
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist");

const site = JSON.parse(readFileSync(join(SRC, "data/site.json"), "utf8"));
const nav = JSON.parse(readFileSync(join(SRC, "data/nav.json"), "utf8"));
const layout = readFileSync(join(SRC, "layouts/base.html"), "utf8");

/* ---------- frontmatter ---------- */
function parseFront(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      v = v.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      v = v.replace(/^["']|["']$/g, "");
    }
    data[k] = v;
  }
  return { data, body: m[2] };
}

/* ---------- markdown (podskup koji nam treba) ---------- */
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = s => s.toLowerCase()
  .replace(/č/g, "c").replace(/ć/g, "c").replace(/š/g, "s").replace(/ž/g, "z").replace(/đ/g, "dj")
  .replace(/[^a-z0-9Ѐ-ӿ]+/g, "-").replace(/^-|-$/g, "");

function inline(s) {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_, alt, src, t) => `<img src="${src}" alt="${alt}" loading="lazy" decoding="async"${t ? ` title="${t}"` : ""}>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) =>
      `<a href="${h}"${/^https?:\/\//.test(h) ? ' rel="noopener"' : ""}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(\d)\s*--\s*(?=\d)/g, "$1–")   // диапазоны чисел: 60--90 -> 60–90
    .replace(/\s--\s/g, " — ")                // тире в предложении
    .replace(/--/g, "—");
}

function markdown(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  const headings = [];
  let i = 0;

  const flushPara = buf => { if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`); buf.length = 0; };

  while (i < lines.length) {
    const line = lines[i];

    // блок с атрибутом класса:  :::card ... :::   (может вкладываться)
    const open = line.match(/^:::\s*([\w-]+)\s*$/);
    if (open) {
      const cls = open[1];
      const inner = [];
      let depth = 1;
      i++;
      while (i < lines.length) {
        if (/^:::\s*[\w-]+\s*$/.test(lines[i])) depth++;
        else if (/^:::\s*$/.test(lines[i])) { depth--; if (!depth) { i++; break; } }
        inner.push(lines[i++]);
      }
      // В сетке каждый ### вместе со своим текстом становится отдельной карточкой,
      // иначе заголовок и абзац попадают в разные ячейки grid-а.
      if ((cls === "grid" || cls === "price") && !/^:::\s*[\w-]+/m.test(inner.join("\n"))) {
        const groups = [];
        let cur = null;
        for (const l of inner) {
          if (/^###\s+/.test(l)) { if (cur) groups.push(cur); cur = [l]; }
          else if (cur) cur.push(l);
          else if (l.trim()) { cur = [l]; }
        }
        if (cur) groups.push(cur);
        if (groups.length) {
          const cards = groups.map(g => {
            const r = markdown(g.join("\n"));
            headings.push(...r.headings);
            return `<div class="card">${r.html}</div>`;
          }).join("");
          out.push(`<div class="${cls}">${cards}</div>`);
          continue;
        }
      }
      const r = markdown(inner.join("\n"));
      headings.push(...r.headings);
      out.push(`<div class="${cls}">${r.html}</div>`);
      continue;
    }

    // осиротевший закрывающий маркер — пропускаем, иначе цикл не двигается
    if (/^:::\s*$/.test(line)) { i++; continue; }

    // заголовок
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const text = h[2].trim();
      const id = slug(text);
      headings.push({ lvl, text, id });
      out.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`);
      i++;
      continue;
    }

    // таблица
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || "")) {
      const cells = r => r.split("|").slice(1, -1).map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="tablebox"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    // списки
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // цитата
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inline(q.join(" "))}</p></blockquote>`);
      continue;
    }

    // параграф
    if (line.trim()) {
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\d+\.\s|>|\||:::)/.test(lines[i])) buf.push(lines[i++]);
      flushPara(buf);
      continue;
    }
    i++;
  }
  return { html: out.join("\n"), headings };
}

/* ---------- FAQ -> Schema (вытаскиваем из самого текста) ---------- */
function extractFaq(body) {
  const faqHead = /^##\s+(Česta pitanja|Частые вопросы|FAQ|Frequently asked questions)\s*$/im;
  const m = body.match(faqHead);
  if (!m) return [];
  const after = body.slice(m.index + m[0].length);
  const stop = after.search(/^##\s+/m);
  const chunk = stop > -1 ? after.slice(0, stop) : after;
  const out = [];
  const re = /^###\s+(.+)$/gm;
  let q;
  while ((q = re.exec(chunk))) {
    const start = q.index + q[0].length;
    const nextIdx = chunk.slice(start).search(/^###\s+/m);
    const ans = (nextIdx > -1 ? chunk.slice(start, start + nextIdx) : chunk.slice(start))
      .replace(/:::[\w-]*/g, "").replace(/[*`>#|]/g, "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(" ");
    if (ans) out.push({ q: q[1].trim(), a: ans });
  }
  return out;
}

/* ---------- сбор страниц ---------- */
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, acc) : extname(p) === ".md" && acc.push(p);
  }
  return acc;
}

const files = walk(join(SRC, "content"));
const pages = files.map(file => {
  const raw = readFileSync(file, "utf8");
  const { data, body } = parseFront(raw);
  const rel = relative(join(SRC, "content"), file).replace(/\\/g, "/");
  const lang = rel.split("/")[0];
  let path = rel.replace(/\.md$/, "").split("/").slice(1).join("/");
  path = path === "index" ? "" : path.replace(/(^|\/)index$/, "");
  const url = lang === site.defaultLang
    ? "/" + (path ? path + "/" : "")
    : "/" + lang + "/" + (path ? path + "/" : "");
  return { file, data, body, lang, url, key: data.key || path || "index" };
});

/* ---------- hreflang ---------- */
const byKey = {};
for (const p of pages) (byKey[p.key] ||= []).push(p);

/* ---------- рендер ---------- */
function breadcrumbs(p) {
  const parts = p.url.split("/").filter(Boolean);
  const base = p.lang === site.defaultLang ? [] : [parts.shift()];
  const crumbs = [{ name: site.home[p.lang], url: "/" + (base.length ? base[0] + "/" : "") }];
  let acc = "/" + (base.length ? base[0] + "/" : "");
  for (let i = 0; i < parts.length; i++) {
    acc += parts[i] + "/";
    const match = pages.find(x => x.url === acc);
    crumbs.push({ name: match ? (match.data.crumb || match.data.h1 || match.data.title) : parts[i], url: acc });
  }
  return crumbs;
}

function schemaFor(p, faq, crumbs) {
  const blocks = [];
  const org = {
    "@type": "ProfessionalService",
    "@id": site.url + "/#organization",
    name: site.name,
    url: site.url + "/",
    email: site.email,
    telephone: site.phone,
    image: site.url + site.logo,
    priceRange: site.priceRange,
    address: { "@type": "PostalAddress", streetAddress: site.address.street, addressLocality: site.address.city, postalCode: site.address.zip, addressCountry: "RS" },
    areaServed: site.areaServed.map(a => ({ "@type": "City", name: a })),
    sameAs: site.sameAs,
    knowsLanguage: ["sr", "ru", "en"]
  };
  if (site.geo) org.geo = { "@type": "GeoCoordinates", latitude: site.geo.lat, longitude: site.geo.lon };
  blocks.push(org);

  blocks.push({
    "@type": "WebSite", "@id": site.url + "/#website",
    url: site.url + "/", name: site.name, inLanguage: p.lang,
    publisher: { "@id": site.url + "/#organization" }
  });

  if (crumbs.length > 1) blocks.push({
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: site.url + c.url }))
  });

  if (p.data.type === "service") {
    const s = {
      "@type": "Service",
      name: p.data.serviceName || p.data.h1,
      description: p.data.description,
      serviceType: p.data.serviceType || p.data.serviceName || p.data.h1,
      provider: { "@id": site.url + "/#organization" },
      areaServed: site.areaServed.map(a => ({ "@type": "City", name: a }))
    };
    if (p.data.priceFrom) s.offers = {
      "@type": "Offer", price: String(p.data.priceFrom), priceCurrency: "EUR",
      url: site.url + p.url, availability: "https://schema.org/InStock"
    };
    blocks.push(s);
  }

  if (p.data.type === "article") blocks.push({
    "@type": "BlogPosting",
    headline: p.data.h1 || p.data.title,
    description: p.data.description,
    datePublished: p.data.date,
    dateModified: p.data.updated || p.data.date,
    inLanguage: p.lang,
    author: { "@type": "Person", name: p.data.author || site.author.name, url: site.url + site.author.url },
    publisher: { "@id": site.url + "/#organization" },
    mainEntityOfPage: site.url + p.url
  });

  if (faq.length) blocks.push({
    "@type": "FAQPage",
    mainEntity: faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
  });

  return JSON.stringify({ "@context": "https://schema.org", "@graph": blocks }, null, 1);
}

function render(p) {
  const { html, headings } = markdown(p.body);
  const faq = extractFaq(p.body);
  const crumbs = breadcrumbs(p);
  const sibs = byKey[p.key] || [];

  const alts = sibs.length > 1
    ? sibs.map(s => `<link rel="alternate" hreflang="${site.hreflang[s.lang]}" href="${site.url}${s.url}">`).join("\n  ")
      + `\n  <link rel="alternate" hreflang="x-default" href="${site.url}${(sibs.find(s => s.lang === site.defaultLang) || sibs[0]).url}">`
    : "";

  const footNav = (nav[p.lang + "_foot"] || nav[p.lang]).map(item =>
    `<p><a href="${item.url}">${item.label}</a></p>`).join("");

  const menu = nav[p.lang].map(item =>
    `<li><a href="${item.url}"${p.url === item.url ? ' aria-current="page"' : ""}>${item.label}</a></li>`).join("");

  const langSwitch = sibs.length > 1
    ? `<ul class="langs">` + sibs.map(s =>
      `<li><a href="${s.url}" hreflang="${site.hreflang[s.lang]}"${s.lang === p.lang ? ' aria-current="true"' : ""}>${site.langLabel[s.lang]}</a></li>`).join("") + `</ul>`
    : "";

  const toc = headings.filter(h => h.lvl === 2);
  const tocHtml = (p.data.toc === "true" && toc.length > 2)
    ? `<nav class="toc" aria-label="${site.tocLabel[p.lang]}"><p class="toc-t">${site.tocLabel[p.lang]}</p><ul>${toc.map(h => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join("")}</ul></nav>`
    : "";

  const crumbHtml = crumbs.length > 1
    ? `<nav class="crumbs" aria-label="${site.crumbLabel[p.lang]}"><ol>${crumbs.map((c, i) =>
      i === crumbs.length - 1
        ? `<li><span aria-current="page">${esc(c.name)}</span></li>`
        : `<li><a href="${c.url}">${esc(c.name)}</a></li>`).join("")}</ol></nav>`
    : "";

  const vars = {
    lang: site.hreflang[p.lang],
    title: p.data.title,
    description: p.data.description,
    canonical: site.url + p.url,
    robots: p.data.noindex === "true" ? '\n<meta name="robots" content="noindex, follow">' : "",
    alternates: alts,
    ogType: p.data.type === "article" ? "article" : "website",
    ogImage: site.url + (p.data.image || site.ogImage),
    schema: schemaFor(p, faq, crumbs),
    menu, footNav, langSwitch, crumbs: crumbHtml, toc: tocHtml,
    h1: p.data.h1 || p.data.title,
    lede: p.data.lede ? `<p class="lede">${inline(p.data.lede)}</p>` : "",
    content: html,
    bodyClass: p.data.bodyClass || "",
    year: new Date().getFullYear(),
    siteName: site.name,
    phone: site.phone, phoneHref: site.phone.replace(/[^+\d]/g, ""),
    email: site.email, viber: site.viber,
    addressLine: `${site.address.street}, ${site.address.zip} ${site.address.city}`,
    navAria: site.navLabel[p.lang],
    footerNote: site.footerNote[p.lang],
    ctaTitle: p.data.ctaTitle || site.cta[p.lang].title,
    ctaText: p.data.ctaText || site.cta[p.lang].text,
    ctaBtn: site.cta[p.lang].btn,
    ctaUrl: site.cta[p.lang].url,
    skip: site.skip[p.lang]
  };

  let out = layout;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v == null ? "" : String(v));
  return out;
}

/* ---------- сборка ---------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const p of pages) {
  const dir = join(OUT, p.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), render(p));
}

// статика
function copyDir(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) {
    const s = join(from, e), d = join(to, e);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}
copyDir(join(SRC, "assets"), join(OUT, "assets"));

// sitemap
const urls = pages.map(p => {
  const sibs = byKey[p.key] || [];
  const links = sibs.length > 1
    ? sibs.map(s => `\n    <xhtml:link rel="alternate" hreflang="${site.hreflang[s.lang]}" href="${site.url}${s.url}"/>`).join("")
    : "";
  return `  <url>\n    <loc>${site.url}${p.url}</loc>\n    <lastmod>${p.data.updated || new Date().toISOString().slice(0, 10)}</lastmod>${links}\n  </url>`;
}).join("\n");
writeFileSync(join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);

// robots
writeFileSync(join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /\n\n# AI pretraživači -- svesno puštamo\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`);

// 404
const nf = pages.find(p => p.key === "404" && p.lang === site.defaultLang);
if (nf) writeFileSync(join(OUT, "404.html"), render(nf));

// заголовки для Netlify/Cloudflare — безвредны на обычном хостинге
writeFileSync(join(OUT, "_headers"),
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n  Permissions-Policy: geolocation=(), microphone=(), camera=()\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

console.log(`Sagrađeno: ${pages.length} stranica -> dist/`);
for (const p of pages) console.log(`  ${p.lang}  ${p.url}`);

/* ---------- lokalni server ---------- */
if (process.argv.includes("--serve")) {
  const { createServer } = await import("node:http");
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2" };
  createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    let f = join(OUT, p);
    try { if (statSync(f).isDirectory()) f = join(f, "index.html"); } catch { f = join(OUT, "404.html"); }
    try {
      const data = readFileSync(f);
      res.writeHead(f.endsWith("404.html") ? 404 : 200, { "Content-Type": types[extname(f)] || "application/octet-stream" });
      res.end(data);
    } catch { res.writeHead(404); res.end("404"); }
  }).listen(8080, () => console.log("http://localhost:8080"));
}
