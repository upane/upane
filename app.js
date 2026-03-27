(() => {
  const DATA_URL_CANDIDATES = ["./data/weekly.json"];
  const FEATURED_RATING_THRESHOLD = 8.0;
  const FEATURED_LIMIT = 3;

  const state = {
    loading: true,
    error: null,
    data: null,
  };

  const root = ensureRoot();

  function ensureRoot() {
    const existing = document.getElementById("app");
    if (existing) return existing;

    const created = document.createElement("div");
    created.id = "app";
    document.body.appendChild(created);
    return created;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined) continue;

      if (key === "className") {
        node.className = value;
        continue;
      }

      if (key === "text") {
        node.textContent = value;
        continue;
      }

      if (key === "html") {
        node.innerHTML = value;
        continue;
      }

      if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
        continue;
      }

      if (key in node) {
        try {
          node[key] = value;
        } catch {
          node.setAttribute(key, String(value));
        }
      } else {
        node.setAttribute(key, String(value));
      }
    }

    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(
        typeof child === "string" ? document.createTextNode(child) : child,
      );
    }

    return node;
  }

  function escapeXml(input) {
    return String(input ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function normalizeText(value, fallback = "") {
    if (value === null || value === undefined) return fallback;
    const text = String(value).replace(/\s+/g, " ").trim();
    return text || fallback;
  }

  function normalizeNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const n = Number(String(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeRating(value) {
    if (value === null || value === undefined) return null;

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const match = value.match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    }

    if (typeof value === "object") {
      if (value.value !== undefined) return normalizeRating(value.value);
      if (value.score !== undefined) return normalizeRating(value.score);
      if (value.rating !== undefined) return normalizeRating(value.rating);
    }

    return null;
  }

  function normalizeRatingCount(value) {
    if (value === null || value === undefined) return null;

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const digits = value.replace(/[^\d]/g, "");
      return digits ? Number(digits) : null;
    }

    if (typeof value === "object") {
      if (value.count !== undefined) return normalizeRatingCount(value.count);
      if (value.value !== undefined) return normalizeRatingCount(value.value);
    }

    return null;
  }

  function isRemoteImage(value) {
    if (!value) return false;
    const text = String(value).trim();
    return /^https?:\/\//i.test(text) || /^data:image\//i.test(text);
  }

  function isRemoteUrl(value) {
    if (!value) return false;
    return /^https?:\/\//i.test(String(value).trim());
  }

  function encodeSvgToDataUrl(svg) {
    const bytes = new TextEncoder().encode(svg);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }

  function truncateText(text, maxLength) {
    const value = normalizeText(text, "");
    if (!value) return "";
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
  }

  function placeholderCover(title, author) {
    const titleText = escapeXml(truncateText(title, 18));
    const authorText = escapeXml(truncateText(author, 24));

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

    return encodeSvgToDataUrl(svg);
  }

  function resolveCover(value, title, author) {
    return placeholderCover(title, author);
  }

  function extractBooks(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== "object") return [];

    if (Array.isArray(raw.books)) return raw.books;
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.recommendations)) return raw.recommendations;
    if (Array.isArray(raw.subjects)) return raw.subjects;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.results)) return raw.results;

    return [];
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeText(item)).filter(Boolean);
    }

    if (typeof value === "string") {
      return value
        .split(/[，,、;/\s]+/g)
        .map((item) => normalizeText(item))
        .filter(Boolean);
    }

    return [];
  }

  function extractDoubanId(...values) {
    for (const value of values) {
      const text = normalizeText(value, "");
      if (!text) continue;

      const match = text.match(
        /(?:douban:\/\/douban\.com\/book\/|\/subject\/)(\d+)/i,
      );
      if (match?.[1]) return match[1];

      if (/^\d+$/.test(text)) return text;
    }

    return "";
  }

  function normalizeBook(raw, index) {
    const source = raw && typeof raw === "object" ? raw : {};
    const target =
      source.target && typeof source.target === "object"
        ? source.target
        : source;
    const subtitle = normalizeText(
      target.card_subtitle || source.card_subtitle || "",
    );
    const subtitleParts = subtitle
      ? subtitle
          .split(/\s*\/\s*/g)
          .map((part) => normalizeText(part))
          .filter(Boolean)
      : [];

    const id =
      normalizeText(
        extractDoubanId(target.uri, source.uri, source.share_url, source.url),
        "",
      ) ||
      normalizeText(
        source.id ??
          target.id ??
          source.book_id ??
          target.book_id ??
          source.subject_id ??
          target.subject_id ??
          "",
        "",
      );

    const title = normalizeText(
      target.title ??
        source.title ??
        target.name ??
        source.name ??
        target.orig_title ??
        source.orig_title ??
        "未命名书籍",
      "未命名书籍",
    );

    const author = normalizeText(
      subtitleParts[0] ||
        target.author ||
        source.author ||
        source.byline ||
        target.byline ||
        "未知作者",
      "未知作者",
    );

    const publishedAt = normalizeText(
      subtitleParts[1] ||
        target.pubdate ||
        source.pubdate ||
        target.published_at ||
        source.published_at ||
        "",
      "",
    );

    const publisher = normalizeText(
      subtitleParts[2] || target.publisher || source.publisher || "",
      "",
    );

    const rating = normalizeRating(
      target.rating?.value ??
        source.rating?.value ??
        target.rating ??
        source.rating ??
        target.score ??
        source.score ??
        null,
    );

    const ratingCount = normalizeRatingCount(
      target.rating?.count ??
        source.rating?.count ??
        target.rating_count ??
        source.rating_count ??
        target.ratingCount ??
        source.ratingCount ??
        target.votes ??
        source.votes ??
        null,
    );

    const summary = normalizeText(
      target.abstract ??
        source.abstract ??
        target.summary ??
        source.summary ??
        target.description ??
        source.description ??
        "",
      "",
    );

    const reason = normalizeText(
      `来自豆瓣移动端关键词「${normalizeText(
        source.keyword ||
          target.keyword ||
          source.search_keyword ||
          target.search_keyword ||
          "推理",
        "推理",
      )}」搜索结果`,
      "",
    );

    const rawCover =
      target.pic?.normal ||
      target.pic?.large ||
      source.pic?.normal ||
      source.pic?.large ||
      target.cover_url ||
      source.cover_url ||
      target.cover ||
      source.cover ||
      "";

    const doubanUrl =
      normalizeText(
        isRemoteUrl(source.share_url) ? source.share_url : "",
        "",
      ) ||
      normalizeText(isRemoteUrl(source.url) ? source.url : "", "") ||
      normalizeText(isRemoteUrl(source.link) ? source.link : "", "") ||
      (id
        ? `https://book.douban.com/subject/${encodeURIComponent(id)}/`
        : "") ||
      (title
        ? `https://m.douban.com/book/subject/${encodeURIComponent(title)}/`
        : "");

    const tags = normalizeTags(
      source.tags ||
        target.tags ||
        source.genres ||
        target.genres ||
        source.genre ||
        target.genre || ["豆瓣", "推理"],
    );

    return {
      id: id || doubanUrl || `${index + 1}`,
      title,
      author,
      rating,
      ratingCount,
      cover: resolveCover(rawCover, title, author),
      summary,
      reason,
      tags: tags.length ? tags : ["豆瓣", "推理"],
      doubanUrl,
      publishedAt,
      publisher,
      originTitle: normalizeText(
        target.original_title || source.original_title || "",
        "",
      ),
      isbn: normalizeText(target.isbn || source.isbn || "", ""),
    };
  }

  function normalizeData(raw) {
    const books = extractBooks(raw).map(normalizeBook);

    const title = normalizeText(
      raw?.title ?? raw?.pageTitle ?? "推理资讯周报",
      "推理资讯周报",
    );
    const subtitle = normalizeText(
      raw?.subtitle ??
        raw?.description ??
        "基于豆瓣移动端 API 自动抓取的推理小说每周推荐",
      "基于豆瓣移动端 API 自动抓取的推理小说每周推荐",
    );
    const theme = normalizeText(
      raw?.theme ?? raw?.weekLabel ?? "推理小说每周推荐",
      "推理小说每周推荐",
    );
    const updatedAt = normalizeText(
      raw?.updatedAt ?? raw?.generatedAt ?? raw?.date ?? raw?.publishAt ?? "",
      "",
    );
    const week = normalizeText(raw?.week ?? raw?.weekLabel ?? "", "");
    const source = raw?.source ?? raw?.dataSource ?? "douban-mobile-api";

    return {
      title,
      subtitle,
      theme,
      week,
      updatedAt,
      source,
      books,
    };
  }

  function sortBooks(books) {
    return [...books].sort((a, b) => {
      const ar = typeof a.rating === "number" ? a.rating : -1;
      const br = typeof b.rating === "number" ? b.rating : -1;

      const aHasRating = ar > 0;
      const bHasRating = br > 0;

      if (aHasRating !== bHasRating) return bHasRating ? 1 : -1;
      if (aHasRating && bHasRating && br !== ar) return br - ar;

      const ac = typeof a.ratingCount === "number" ? a.ratingCount : -1;
      const bc = typeof b.ratingCount === "number" ? b.ratingCount : -1;
      if (bc !== ac) return bc - ac;

      return String(a.title).localeCompare(String(b.title), "zh-Hans-CN");
    });
  }

  function uniqueBooks(books) {
    const seen = new Set();
    const out = [];

    for (const book of books) {
      const key = normalizeText(book.doubanUrl || book.id || book.title, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(book);
    }

    return out;
  }

  function pickFeaturedBooks(books) {
    const highRated = books.filter(
      (book) => (book.rating ?? 0) >= FEATURED_RATING_THRESHOLD,
    );

    if (highRated.length >= FEATURED_LIMIT) {
      return sortBooks(highRated).slice(0, FEATURED_LIMIT);
    }

    return sortBooks(books).slice(0, FEATURED_LIMIT);
  }

  function formatDate(value) {
    if (!value) return "未更新";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return normalizeText(value, "未更新");

    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatRating(value) {
    const rating = typeof value === "number" ? value : normalizeRating(value);
    if (!rating || rating <= 0) return "暂无评分";
    return rating.toFixed(1);
  }

  function formatRatingCount(value) {
    const count = normalizeRatingCount(value);
    if (!count || count <= 0) return "";
    return `${count.toLocaleString("zh-CN")} 评价`;
  }

  function setDocumentMeta(data) {
    document.title = `${data.title || "推理资讯周报"} · 豆瓣周报`;

    const descriptionText = normalizeText(
      `${data.subtitle || ""} ${data.theme || ""}`.trim(),
      "推理小说每周推荐",
    );

    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", descriptionText);
  }

  function renderTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return null;

    return el(
      "div",
      { className: "book-card__tags" },
      tags
        .slice(0, 4)
        .map((tag) => el("span", { className: "tag", text: tag })),
    );
  }

  function renderLoading() {
    return el("section", { className: "loading-state" }, [
      el("div", { className: "loading-state__spinner", "aria-hidden": "true" }),
      el("p", {
        className: "loading-state__text",
        text: "正在加载本周推理书单…",
      }),
    ]);
  }

  function renderError(message) {
    return el("section", { className: "error-state" }, [
      el("h2", { className: "error-state__title", text: "加载失败" }),
      el("p", { className: "error-state__text", text: message }),
      el("button", {
        className: "btn btn--primary",
        text: "重新加载",
        onclick: () => loadData(true),
      }),
    ]);
  }

  function renderEmpty() {
    return el("section", { className: "empty-state" }, [
      el("h2", { className: "empty-state__title", text: "本周暂无推荐内容" }),
      el("p", {
        className: "empty-state__text",
        text: "请检查 weekly.json 是否已更新，或等待 GitHub Actions 自动生成最新内容。",
      }),
    ]);
  }

  function renderBookCard(book, { featured = false } = {}) {
    const titleLine = el("div", { className: "book-card__topline" }, [
      el("h3", { className: "book-card__title", text: book.title }),
      el("span", {
        className: `book-card__rating ${
          book.rating && book.rating > 0 ? "" : "book-card__rating--muted"
        }`,
        text: formatRating(book.rating),
      }),
    ]);

    const meta = el("p", {
      className: "book-card__author",
      text: [
        `作者：${book.author || "未知作者"}`,
        book.publishedAt ? `出版：${book.publishedAt}` : "",
        formatRatingCount(book.ratingCount),
      ]
        .filter(Boolean)
        .join(" · "),
    });

    const desc = el("p", {
      className: "book-card__intro",
      text: book.summary || "暂无简介。",
    });

    const reason = book.reason
      ? el("p", {
          className: "book-card__reason",
          text: `推荐理由：${book.reason}`,
        })
      : null;

    const coverNode = book.cover
      ? el("img", {
          className: "book-card__cover",
          src: book.cover,
          alt: `${book.title} 封面`,
          loading: "lazy",
        })
      : el("div", {
          className: "book-card__cover book-card__cover--placeholder",
          text: "NO COVER",
        });

    const actions = el("div", { className: "book-card__actions" }, [
      book.doubanUrl
        ? el("a", {
            className: "btn btn--primary",
            href: book.doubanUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            text: "打开豆瓣",
          })
        : null,
      el("button", {
        className: "btn",
        text: "复制标题",
        onclick: async (event) => {
          try {
            await navigator.clipboard.writeText(book.title || "");
            const button = event.currentTarget;
            const original = button.textContent;
            button.textContent = "已复制";
            setTimeout(() => {
              button.textContent = original;
            }, 1200);
          } catch {
            alert(book.title || "");
          }
        },
      }),
    ]);

    return el(
      "article",
      { className: `book-card${featured ? " book-card--featured" : ""}` },
      [
        el("div", { className: "book-card__cover-wrap" }, [coverNode]),
        el("div", { className: "book-card__body" }, [
          titleLine,
          meta,
          tagsNode(book.tags),
          desc,
          reason,
          actions,
        ]),
      ],
    );
  }

  function tagsNode(tags) {
    return renderTags(tags);
  }

  function renderListItem(book) {
    const ratingText = formatRating(book.rating);
    const ratingCount = formatRatingCount(book.ratingCount);
    const subtitleParts = [
      book.author ? `作者：${book.author}` : "",
      book.publishedAt ? `出版：${book.publishedAt}` : "",
      ratingCount,
    ].filter(Boolean);

    return el("div", { className: "list__item" }, [
      el("div", { className: "list__bullet", "aria-hidden": "true" }),
      el("div", { className: "list__content" }, [
        el("h3", { className: "list__title", text: book.title }),
        el("p", {
          className: "list__text",
          text: subtitleParts.join(" · ") || "暂无详情",
        }),
        el("p", {
          className: "list__text",
          text: book.reason || book.summary || "豆瓣推荐条目",
        }),
        el("div", { className: "book-card__footer" }, [
          el("span", {
            className: "rating",
            text: `评分 ${ratingText}`,
          }),
          book.doubanUrl
            ? el("a", {
                className: "link",
                href: book.doubanUrl,
                target: "_blank",
                rel: "noopener noreferrer",
                text: "查看详情 →",
              })
            : null,
        ]),
      ]),
    ]);
  }

  function renderKpi(label, value) {
    return el("div", { className: "kpi__item" }, [
      el("p", { className: "kpi__value", text: value }),
      el("p", { className: "kpi__label", text: label }),
    ]);
  }

  function renderDashboard(data) {
    const sortedBooks = sortBooks(uniqueBooks(data.books));
    const featuredBooks = pickFeaturedBooks(sortedBooks);
    const featuredKeys = new Set(
      featuredBooks.map((book) =>
        normalizeText(book.doubanUrl || book.id || book.title, ""),
      ),
    );
    const remainingBooks = sortedBooks.filter(
      (book) =>
        !featuredKeys.has(
          normalizeText(book.doubanUrl || book.id || book.title, ""),
        ),
    );

    const ratedBooks = sortedBooks.filter((book) => (book.rating ?? 0) > 0);
    const averageRating = ratedBooks.length
      ? ratedBooks.reduce((sum, book) => sum + (book.rating || 0), 0) /
        ratedBooks.length
      : null;

    const stats = el("div", { className: "kpi" }, [
      renderKpi("书目总数", `${sortedBooks.length} 本`),
      renderKpi("入围精选", `${featuredBooks.length} 本`),
      renderKpi("平均评分", averageRating ? averageRating.toFixed(1) : "暂无"),
    ]);

    const featureSection = el("section", { className: "section" }, [
      el("h2", { className: "section__title", text: "本周精选 · 入围推荐" }),
      featuredBooks.length
        ? el(
            "div",
            { className: "cards" },
            featuredBooks.map((book) =>
              renderBookCard(book, { featured: true }),
            ),
          )
        : renderEmpty(),
    ]);

    const allSection = el("section", { className: "section" }, [
      el("h2", {
        className: "section__title",
        text: `完整书单 · 共 ${sortedBooks.length} 本`,
      }),
      remainingBooks.length
        ? el("div", { className: "list" }, remainingBooks.map(renderListItem))
        : el("p", { className: "muted", text: "没有更多条目。" }),
    ]);

    const mainPanel = el("section", { className: "panel panel--strong" }, [
      el("div", { className: "panel__header" }, [
        el("div", null, [
          el("h2", { className: "panel__title", text: "推理资讯周报" }),
          el("div", {
            className: "panel__subtitle",
            text: data.week
              ? `周次：${data.week}`
              : `更新：${formatDate(data.updatedAt)}`,
          }),
        ]),
        el("div", { className: "toolbar__group" }, [
          el("span", {
            className: "badge badge--primary",
            text: `固定阈值 ≥ ${FEATURED_RATING_THRESHOLD.toFixed(1)}`,
          }),
          el("button", {
            className: "btn",
            text: "重新加载",
            onclick: () => loadData(true),
          }),
        ]),
      ]),
      el("div", { className: "panel__body" }, [
        stats,
        featureSection,
        allSection,
      ]),
    ]);

    const sidePanel = el("aside", { className: "panel" }, [
      el("div", { className: "panel__header" }, [
        el("div", null, [
          el("h2", { className: "panel__title", text: "本周概览" }),
          el("div", {
            className: "panel__subtitle",
            text: normalizeText(
              data.theme || data.subtitle || "豆瓣数据自动更新",
              "豆瓣数据自动更新",
            ),
          }),
        ]),
      ]),
      el("div", { className: "panel__body" }, [
        renderKpi("更新时间", formatDate(data.updatedAt)),
        el("div", { style: "height:12px" }),
        renderKpi("数据来源", normalizeSource(data.source)),
        el("div", { style: "height:12px" }),
        renderKpi("展示逻辑", "评分优先 · 兜底排序"),
        el("div", { className: "section" }, [
          el("h2", { className: "section__title", text: "说明" }),
          el("div", { className: "list" }, [
            el("div", { className: "list__item" }, [
              el("div", { className: "list__bullet", "aria-hidden": "true" }),
              el("div", { className: "list__content" }, [
                el("h3", { className: "list__title", text: "封面策略" }),
                el("p", {
                  className: "list__text",
                  text: "优先使用豆瓣远程封面链接，拿不到时自动生成内嵌 SVG 占位图，不依赖本地静态图片。",
                }),
              ]),
            ]),
            el("div", { className: "list__item" }, [
              el("div", { className: "list__bullet", "aria-hidden": "true" }),
              el("div", { className: "list__content" }, [
                el("h3", { className: "list__title", text: "排序规则" }),
                el("p", {
                  className: "list__text",
                  text: "高评分优先，其次按评价人数与标题排序。若评分字段缺失，则自动回退到评价人数排序。",
                }),
              ]),
            ]),
            el("div", { className: "list__item" }, [
              el("div", { className: "list__bullet", "aria-hidden": "true" }),
              el("div", { className: "list__content" }, [
                el("h3", { className: "list__title", text: "数据刷新" }),
                el("p", {
                  className: "list__text",
                  text: "GitHub Actions 定时刷新 weekly.json，页面采用 no-store 拉取，减少缓存导致的旧内容问题。",
                }),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);

    return el("main", { className: "page-shell" }, [
      renderHero(data, sortedBooks),
      renderToolbar(),
      el("div", { className: "grid" }, [mainPanel, sidePanel]),
      renderFooter(),
    ]);
  }

  function renderHero(data, books) {
    const featuredCount = books.filter(
      (book) => (book.rating ?? 0) >= FEATURED_RATING_THRESHOLD,
    ).length;
    const ratedBooks = books.filter((book) => (book.rating ?? 0) > 0);
    const averageRating = ratedBooks.length
      ? ratedBooks.reduce((sum, book) => sum + (book.rating || 0), 0) /
        ratedBooks.length
      : null;

    const chips = [
      data.theme ? `主题：${data.theme}` : "主题：推理周报",
      data.updatedAt
        ? `更新时间：${formatDate(data.updatedAt)}`
        : "更新时间：待更新",
      `精选入围：${featuredCount} 本`,
      `固定阈值：≥ ${FEATURED_RATING_THRESHOLD.toFixed(1)}`,
    ];

    return el("section", { className: "hero" }, [
      el("p", { className: "hero__eyebrow", text: "每周精选 · 本周报告" }),
      el("h1", { text: data.title || "推理资讯周报" }),
      el("p", {
        text:
          data.subtitle ||
          "基于豆瓣移动端 API 自动生成的本周推理书单，固定阈值以上优先进入精选。",
      }),
      el(
        "div",
        { className: "hero__meta" },
        chips.map((chip) => el("span", { className: "badge", text: chip })),
      ),
      el("div", { className: "hero__actions" }, [
        el("a", {
          className: "btn btn--primary",
          href: "./data/weekly.json",
          target: "_blank",
          rel: "noopener noreferrer",
          text: "查看周报数据",
        }),
        el("span", {
          className: "badge badge--success",
          text: averageRating
            ? `平均评分：${averageRating.toFixed(1)}`
            : "平均评分：暂无",
        }),
      ]),
    ]);
  }

  function renderToolbar() {
    return el("div", { className: "toolbar" }, [
      el("div", { className: "toolbar__group" }, [
        el("span", { className: "toolbar__label", text: "展示策略：" }),
        el("span", {
          className: "badge badge--primary",
          text: `固定阈值：评分 ≥ ${FEATURED_RATING_THRESHOLD.toFixed(1)}`,
        }),
      ]),
      el("div", { className: "toolbar__group" }, [
        el("a", {
          className: "btn",
          href: "./data/weekly.json",
          target: "_blank",
          rel: "noopener noreferrer",
          text: "打开 weekly.json",
        }),
      ]),
    ]);
  }

  function renderFooter() {
    return el("footer", { className: "footer" }, [
      el("p", {
        className: "footer__text",
        text: "本页面由 GitHub Pages 自动更新 · 豆瓣移动端数据优先 · 无本地图片依赖",
      }),
      el("p", {
        className: "footer__text footer__text--muted",
        text: `最后渲染：${new Date().toLocaleString("zh-CN")}`,
      }),
    ]);
  }

  function normalizeSource(source) {
    if (!source) return "Douban / curated";
    if (typeof source === "string") return source;

    if (typeof source === "object") {
      return normalizeText(
        source.type ||
          source.name ||
          source.description ||
          source.url ||
          "Douban / curated",
        "Douban / curated",
      );
    }

    return "Douban / curated";
  }

  function renderApp(data) {
    setDocumentMeta(data);

    const content = data.books.length
      ? renderDashboard(data)
      : el("main", { className: "page-shell" }, [
          renderHero(data, []),
          renderToolbar(),
          el("div", { className: "grid" }, [
            el("section", { className: "panel panel--strong" }, [
              el("div", { className: "panel__header" }, [
                el("div", null, [
                  el("h2", { className: "panel__title", text: "本周精选" }),
                  el("div", {
                    className: "panel__subtitle",
                    text: "当前没有可展示书目，等待下一次刷新。",
                  }),
                ]),
              ]),
              el("div", { className: "panel__body" }, [renderEmpty()]),
            ]),
            el("aside", { className: "panel" }, [
              el("div", { className: "panel__header" }, [
                el("div", null, [
                  el("h2", { className: "panel__title", text: "本周概览" }),
                  el("div", {
                    className: "panel__subtitle",
                    text: normalizeText(
                      data.subtitle || "数据未就绪",
                      "数据未就绪",
                    ),
                  }),
                ]),
              ]),
              el("div", { className: "panel__body" }, [
                renderKpi("更新时间", formatDate(data.updatedAt)),
                el("div", { style: "height:12px" }),
                renderKpi("数据来源", normalizeSource(data.source)),
                el("div", { style: "height:12px" }),
                renderKpi("展示逻辑", "评分优先 · 兜底排序"),
              ]),
            ]),
          ]),
          renderFooter(),
        ]);

    root.innerHTML = "";
    root.appendChild(content);
  }

  function getWeeklyJsonCandidates() {
    const pathname = window.location.pathname || "/";
    const candidates = [
      "./data/weekly.json",
      "/data/weekly.json",
      "/upane/data/weekly.json",
    ];

    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      candidates.push(`/${segments[0]}/data/weekly.json`);
    }

    return [...new Set(candidates)];
  }

  async function fetchWeeklyDataWithFallback() {
    const candidates = [
      ...new Set([...DATA_URL_CANDIDATES, ...getWeeklyJsonCandidates()]),
    ];

    let lastError = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          lastError = new Error(`无法读取 ${url}（HTTP ${response.status}）`);
          continue;
        }

        return await response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError || new Error("无法读取 weekly.json");
  }

  async function loadData(force = false) {
    state.loading = true;
    state.error = null;

    root.innerHTML = "";
    root.appendChild(renderLoading());

    try {
      const raw = await fetchWeeklyDataWithFallback();
      const normalized = normalizeData(raw);
      const ranked = sortBooks(uniqueBooks(normalized.books));

      state.data = {
        ...normalized,
        books: ranked,
      };
      state.loading = false;
      renderApp(state.data);
    } catch (error) {
      state.loading = false;
      state.error = error instanceof Error ? error.message : "未知错误";
      renderErrorPage(state.error);
    }
  }

  function renderErrorPage(message) {
    root.innerHTML = "";
    root.appendChild(
      el("main", { className: "page-shell" }, [
        el("section", { className: "hero" }, [
          el("p", { className: "hero__eyebrow", text: "加载失败" }),
          el("h1", { text: "推理资讯周报" }),
          el("p", {
            text: message || "未能加载 weekly.json，请稍后重试。",
          }),
          el("div", { className: "hero__actions" }, [
            el("button", {
              className: "btn btn--primary",
              text: "重新加载",
              onclick: () => loadData(true),
            }),
            el("a", {
              className: "btn",
              href: "./data/weekly.json",
              target: "_blank",
              rel: "noopener noreferrer",
              text: "查看原始数据",
            }),
          ]),
        ]),
        renderFooter(),
      ]),
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadData();
  });
})();
