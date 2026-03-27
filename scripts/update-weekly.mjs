#!/usr/bin/env node
/**
 * Weekly Douban mystery-fiction digest generator.
 *
 * Strategy:
 * 1) Use Douban mobile search API first.
 * 2) Normalize the search response into a stable weekly JSON payload.
 * 3) Use remote cover URLs when available.
 * 4) Fall back to inline SVG data-URI placeholders for missing covers.
 *
 * Output:
 * - Writes ./data/weekly.json
 * - No local image files are referenced
 * - Covers are either remote URLs or data:image/svg+xml;base64 placeholders
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_PATH = resolve(__dirname, "../data/weekly.json");

const MOBILE_SEARCH_API = "https://m.douban.com/rexxar/api/v2/search/book";
const MOBILE_BOOK_WEB = "https://m.douban.com/book/subject/";

const KEYWORDS = [
  "推理小说",
  "悬疑小说",
  "侦探小说",
  "本格推理",
  "社会派推理",
  "东野圭吾",
  "阿加莎·克里斯蒂",
  "岛田庄司",
];

const MAX_RESULTS = 10;
const REQUEST_DELAY_MS = 900;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  const time = Number(ms);
  if (!Number.isFinite(time) || time <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, time));
}

function trimText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || fallback;
}

function asNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function pickFirst(...values) {
  for (const value of values) {
    const text = trimText(value, "");
    if (text) return text;
  }
  return "";
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildWeekLabel(date = new Date()) {
  const day = date.getDay() || 7; // Monday = 1, Sunday = 7
  const monday = new Date(date);
  monday.setDate(date.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });

  return `${fmt.format(monday)} - ${fmt.format(sunday)}`;
}

function isRemoteImage(value) {
  if (!value) return false;
  const text = String(value).trim();
  return /^https?:\/\//i.test(text) || /^data:image\//i.test(text);
}

function escapeXml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(input, maxLength) {
  const text = trimText(input, "");
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function placeholderCover(title, author) {
  const titleText = escapeXml(truncate(title, 18));
  const authorText = escapeXml(truncate(author, 24));

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10233d"/>
      <stop offset="50%" stop-color="#163a60"/>
      <stop offset="100%" stop-color="#0a1424"/>
    </linearGradient>
    <radialGradient id="r" cx="20%" cy="20%" r="90%">
      <stop offset="0%" stop-color="#61d0ff" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#61d0ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="480" height="640" rx="36" fill="url(#g)"/>
  <rect width="480" height="640" rx="36" fill="url(#r)"/>
  <circle cx="390" cy="100" r="84" fill="#7df0c8" fill-opacity="0.12"/>
  <circle cx="92" cy="540" r="120" fill="#ffc857" fill-opacity="0.10"/>
  <rect x="40" y="56" width="400" height="528" rx="28" fill="none" stroke="#8faed6" stroke-opacity="0.18" stroke-width="2"/>
  <text x="56" y="110" fill="#8faed6" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-size="28" letter-spacing="2">DOUBAN</text>
  <text x="56" y="235" fill="#edf4ff" font-family="Noto Serif SC, Source Han Serif SC, Songti SC, serif" font-size="52" font-weight="700">
    <tspan x="56" dy="0">${titleText}</tspan>
  </text>
  <text x="56" y="530" fill="#c6d8ef" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-size="24">
    <tspan x="56" dy="0">${authorText}</tspan>
  </text>
  <text x="56" y="580" fill="#8faed6" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-size="18" opacity="0.8">推理资讯周报 · 自动生成封面</text>
</svg>`.trim();

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function safeCover(value, title, author) {
  if (isRemoteImage(value)) return String(value).trim();
  return placeholderCover(title, author);
}

function extractDoubanId(...values) {
  for (const value of values) {
    const text = trimText(value, "");
    if (!text) continue;

    const match = text.match(
      /(?:douban:\/\/douban\.com\/book\/|\/subject\/)(\d+)/i,
    );
    if (match?.[1]) return match[1];

    if (/^\d+$/.test(text)) return text;
  }

  return "";
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => trimText(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[，,、;/\s]+/g)
      .map((item) => trimText(item))
      .filter(Boolean);
  }

  return [];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://m.douban.com/",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 240)}` : ""}`,
    );
  }

  return response.json();
}

function buildSearchUrl(keyword) {
  const url = new URL(MOBILE_SEARCH_API);
  url.searchParams.set("q", keyword);
  url.searchParams.set("count", "10");
  url.searchParams.set("start", "0");
  return url.href;
}

function buildWebSubjectUrl(id) {
  return `${MOBILE_BOOK_WEB}${encodeURIComponent(id)}/`;
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.books)) return payload.books;
  if (Array.isArray(payload.subjects)) return payload.subjects;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function normalizeSearchItem(item, keyword) {
  const raw = item && typeof item === "object" ? item : {};
  const target =
    raw.target && typeof raw.target === "object" ? raw.target : raw;

  const id = pickFirst(
    raw.target_id,
    target.id,
    extractDoubanId(target.uri, raw.uri, raw.share_url, raw.url),
    raw.id,
    target.book_id,
    target.subject_id,
    "",
  );

  const title = pickFirst(
    target.title,
    raw.title,
    target.name,
    target.orig_title,
    "未命名书籍",
  );

  const subtitle = pickFirst(target.card_subtitle, raw.card_subtitle, "");
  const subtitleParts = subtitle
    ? subtitle
        .split(/\s*\/\s*/g)
        .map((part) => trimText(part))
        .filter(Boolean)
    : [];

  const author = pickFirst(
    subtitleParts[0],
    target.author,
    raw.author,
    raw.byline,
    "未知作者",
  );

  const publishedAt = pickFirst(
    subtitleParts[1],
    target.pubdate,
    raw.pubdate,
    "",
  );
  const publisher = pickFirst(
    subtitleParts[2],
    target.publisher,
    raw.publisher,
    "",
  );
  const summary = pickFirst(
    target.abstract,
    raw.abstract,
    target.summary,
    raw.summary,
    "",
  );

  const rating = asNumber(
    target.rating?.value ?? raw.rating?.value ?? target.rating?.star_count,
    asNumber(target.rating, asNumber(raw.rating, null)),
  );

  const ratingCount = asNumber(
    target.rating?.count ?? raw.rating?.count,
    asNumber(
      target.rating_count,
      asNumber(raw.ratingCount, asNumber(raw.votes, null)),
    ),
  );

  const cover = safeCover(
    pickFirst(
      target.pic?.normal,
      target.pic?.large,
      raw.pic?.normal,
      raw.pic?.large,
      target.cover_url,
      raw.cover_url,
      target.cover,
      raw.cover,
      "",
    ),
    title,
    author,
  );

  const doubanUrl = pickFirst(
    raw.share_url,
    raw.url,
    raw.link,
    target.uri,
    raw.uri,
    id ? buildWebSubjectUrl(id) : "",
  );

  return {
    id: id || doubanUrl || title,
    title,
    author,
    rating,
    ratingCount,
    cover,
    summary,
    reason: `来自豆瓣移动端关键词「${keyword}」搜索结果`,
    tags: normalizeTags([keyword, raw.type_name || target.type_name || "豆瓣"]),
    doubanUrl,
    publishedAt,
    publisher,
    originTitle: pickFirst(target.original_title, raw.original_title, ""),
    isbn: pickFirst(target.isbn, raw.isbn, ""),
  };
}

function normalizeDetailItem(detail, fallback = {}) {
  const raw = detail && typeof detail === "object" ? detail : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};

  const id = pickFirst(
    raw.id,
    raw.subject_id,
    extractDoubanId(raw.uri, raw.share_url, raw.url, base.doubanUrl),
    base.id,
    "",
  );
  const title = pickFirst(raw.title, raw.name, base.title, "未命名书籍");
  const author = pickFirst(raw.author, raw.authors, base.author, "未知作者");
  const rating = asNumber(
    raw.rating?.value ?? raw.rating?.star_count,
    asNumber(base.rating, null),
  );
  const ratingCount = asNumber(
    raw.rating?.count ?? raw.rating_count,
    asNumber(base.ratingCount, null),
  );

  const cover = safeCover(
    pickFirst(
      raw.pic?.normal,
      raw.pic?.large,
      raw.cover,
      raw.image,
      base.cover,
      "",
    ),
    title,
    author,
  );

  const url = pickFirst(
    raw.share_url,
    raw.url,
    raw.alt,
    raw.uri,
    base.doubanUrl,
    id ? buildWebSubjectUrl(id) : "",
  );

  const tags = normalizeTags(raw.tags || raw.genres || base.tags || []);

  return {
    id: id || url || title,
    title,
    author,
    rating,
    ratingCount,
    cover,
    summary: pickFirst(raw.summary, raw.abstract, base.summary, ""),
    reason: pickFirst(raw.reason, base.reason, `豆瓣详情页：${title}`),
    tags: tags.length ? tags : ["豆瓣", "推理"],
    doubanUrl: url || buildWebSubjectUrl(id || title),
    publishedAt: pickFirst(raw.published_at, raw.pubdate, base.publishedAt, ""),
    publisher: pickFirst(raw.publisher, base.publisher, ""),
    originTitle: pickFirst(raw.original_title, base.originTitle, ""),
    isbn: pickFirst(raw.isbn, base.isbn, ""),
  };
}

async function searchByKeyword(keyword) {
  const url = buildSearchUrl(keyword);
  const payload = await fetchJson(url);
  const items = extractItems(payload);
  return items.map((item) => normalizeSearchItem(item, keyword));
}

async function fetchDetailForBook(book) {
  const id = trimText(book.id, "");
  if (!id) return normalizeDetailItem({}, book);

  try {
    const detailUrl = `https://m.douban.com/rexxar/api/v2/book/${encodeURIComponent(id)}`;
    const payload = await fetchJson(detailUrl);
    return normalizeDetailItem(payload, book);
  } catch {
    return normalizeDetailItem({}, book);
  }
}

function mergeAndRankBooks(allBooks) {
  const deduped = uniqueBy(allBooks, (book) => {
    const key = book.doubanUrl || book.id || book.title;
    return key ? String(key).trim() : "";
  });

  const ranked = deduped
    .map((book) => ({
      ...book,
      rating: asNumber(book.rating, null),
      ratingCount: asNumber(book.ratingCount, null),
    }))
    .sort((a, b) => {
      const ra = a.rating ?? -1;
      const rb = b.rating ?? -1;
      if (rb !== ra) return rb - ra;
      const va = a.ratingCount ?? -1;
      const vb = b.ratingCount ?? -1;
      if (vb !== va) return vb - va;
      return String(a.title).localeCompare(String(b.title), "zh-Hans-CN");
    });

  const highRated = ranked.filter((book) => (book.rating ?? 0) >= 8);

  const selected =
    highRated.length >= Math.min(3, MAX_RESULTS) ? highRated : ranked;

  return selected.slice(0, MAX_RESULTS).map((book, index) => {
    const title = trimText(book.title, "未命名书籍");
    const author = trimText(book.author, "未知作者");

    return {
      id: trimText(book.id, `${index + 1}`),
      title,
      author,
      rating: book.rating,
      ratingCount: book.ratingCount,
      cover: safeCover(book.cover, title, author),
      summary: trimText(book.summary, ""),
      reason: trimText(
        book.reason,
        book.rating
          ? `本周高分推荐：${title}`
          : `本周推荐第 ${index + 1} 位：${title}`,
      ),
      tags: normalizeTags(book.tags).length
        ? normalizeTags(book.tags)
        : ["豆瓣", "推理"],
      doubanUrl: pickFirst(book.doubanUrl, buildWebSubjectUrl(book.id)),
      publishedAt: trimText(book.publishedAt, ""),
      publisher: trimText(book.publisher, ""),
      originTitle: trimText(book.originTitle, ""),
      isbn: trimText(book.isbn, ""),
    };
  });
}

async function buildFallbackBooks() {
  return [
    {
      id: "sample-1",
      title: "示例书目：推理小说的世界",
      author: "示例作者",
      rating: 8.7,
      ratingCount: 1234,
      cover: placeholderCover("示例书目：推理小说的世界", "示例作者"),
      summary:
        "当前没有抓到豆瓣结果时的兜底示例。封面使用内嵌 SVG data URI，不依赖本地静态文件。",
      reason: "保证页面始终有可展示内容。",
      tags: ["示例", "默认数据"],
      doubanUrl: "https://m.douban.com/book/subject/0/",
      publishedAt: "",
      publisher: "",
      originTitle: "",
      isbn: "",
    },
  ];
}

function buildOutput(books) {
  const normalizedBooks = books.map((book, index) => {
    const title = trimText(book.title, "未命名书籍");
    const author = trimText(book.author, "未知作者");
    const tags = normalizeTags(book.tags);

    return {
      id: trimText(book.id, `${index + 1}`),
      title,
      author,
      rating: asNumber(book.rating, null),
      ratingCount: asNumber(book.ratingCount, null),
      cover: safeCover(book.cover, title, author),
      summary: trimText(book.summary, ""),
      reason: trimText(book.reason, `豆瓣推荐：${title}`),
      tags: tags.length ? tags : ["豆瓣", "推理"],
      doubanUrl: pickFirst(book.doubanUrl, buildWebSubjectUrl(book.id)),
      publishedAt: trimText(book.publishedAt, ""),
      publisher: trimText(book.publisher, ""),
      originTitle: trimText(book.originTitle, ""),
      isbn: trimText(book.isbn, ""),
    };
  });

  return {
    title: "推理资讯周报",
    subtitle: "基于豆瓣移动端 API 自动抓取的推理小说每周推荐",
    theme: "推理小说每周推荐",
    week: buildWeekLabel(),
    updatedAt: nowIso(),
    generatedAt: nowIso(),
    source: {
      type: "douban-mobile-api",
      url: MOBILE_SEARCH_API,
      detail: "https://m.douban.com/rexxar/api/v2/book/{id}",
      web: MOBILE_BOOK_WEB,
    },
    itemCount: normalizedBooks.length,
    books: normalizedBooks,
    items: normalizedBooks,
  };
}

async function writeOutputFile(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  let collected = [];

  for (const keyword of KEYWORDS) {
    try {
      const results = await searchByKeyword(keyword);
      collected.push(...results);
      console.log(
        `[update-weekly] keyword="${keyword}" => ${results.length} result(s)`,
      );
    } catch (error) {
      console.warn(
        `[update-weekly] search failed for "${keyword}": ${error.message}`,
      );
    }

    if (collected.length >= MAX_RESULTS * 3) break;
    await sleep(REQUEST_DELAY_MS);
  }

  collected = uniqueBy(
    collected,
    (book) => book.doubanUrl || book.id || book.title,
  );

  if (collected.length === 0) {
    console.warn(
      "[update-weekly] No books collected from mobile API, using fallback sample.",
    );
    collected = await buildFallbackBooks();
  } else {
    const detailed = [];
    const limited = collected.slice(0, MAX_RESULTS * 2);

    for (const book of limited) {
      try {
        const detail = await fetchDetailForBook(book);
        detailed.push(detail);
        console.log(`[update-weekly] detail fetched => ${detail.title}`);
      } catch (error) {
        console.warn(
          `[update-weekly] detail failed for "${book.title}": ${error.message}`,
        );
        detailed.push(normalizeDetailItem({}, book));
      }

      await sleep(REQUEST_DELAY_MS);
    }

    collected = detailed;
  }

  const output = buildOutput(mergeAndRankBooks(collected));
  await writeOutputFile(OUTPUT_PATH, output);

  console.log(
    `[update-weekly] Wrote ${output.itemCount} item(s) to ${OUTPUT_PATH}`,
  );
}

main().catch((error) => {
  console.error(`[update-weekly] Fatal error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
