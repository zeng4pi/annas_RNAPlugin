#!/usr/bin/env node
// Anna's Archive MCP server (stdio transport).
//
// Two tools:
//   - search_books  → scrape the public search page, return result rows
//   - download_book → call the Members fast-download API with the user's key,
//                     stream the returned URL to disk, hand back the path.
//
// Auth: ANNAS_ARCHIVE_API_KEY is required for download_book only. Search works
// anonymously. Both come from plugin user_config (see ../../plugin.yaml).
//
// Network endpoints are constrained by the host plugin manager's allowlist,
// per Plugin_Composition_Spec_v1 §6 invariant (d). This process MUST NOT open
// arbitrary outbound connections — it just calls the allowlisted hosts.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";

const ANNAS_BASE = "https://annas-archive.org";
const KNOWN_EXTS = new Set([
  "epub", "pdf", "mobi", "azw3", "azw", "djvu", "fb2", "lit",
  "rtf", "doc", "docx", "txt", "cbr", "cbz",
]);

// ----------------- Search ------------------------------------------------

async function searchBooks({ query, ext, language, limit }) {
  if (!query || typeof query !== "string") {
    throw new Error("search_books: 'query' is required");
  }
  const cap = Math.max(1, Math.min(50, Number(limit) || 10));

  const params = new URLSearchParams({ q: query });
  if (ext && ext !== "any") params.set("ext", ext);
  if (language && language !== "any") params.set("lang", language);
  const url = `${ANNAS_BASE}/search?${params.toString()}`;

  const timeoutMs = Number(process.env.ANNAS_SEARCH_TIMEOUT_MS) || 20000;
  const html = await fetchText(url, { timeoutMs });
  return { results: parseSearchHtml(html, cap) };
}

function parseSearchHtml(html, cap) {
  // Pull every <a href="/md5/<32 hex>"> block. The HTML markup at Anna's
  // Archive evolves; this parser stays defensive — it captures the link's
  // inner HTML and reads metadata heuristically from the text nodes.
  const re = /<a\b[^>]*href="\/md5\/([a-f0-9]{32})"[^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const md5 = m[1];
    if (seen.has(md5)) continue;
    seen.add(md5);
    const inner = m[2];
    const row = parseResultBlock(md5, inner);
    if (row) out.push(row);
    if (out.length >= cap) break;
  }
  return out;
}

function parseResultBlock(md5, inner) {
  // Walk inner HTML and tag each text run by the class attribute of the
  // immediately enclosing element. Anna's Archive marks title with
  // `font-bold` (and/or `text-xl`), publisher with `italic`, and the
  // extension/size line with `text-xs`. The exact class names drift over
  // time, so we treat them as hints, not assertions.
  const cleaned = inner
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const segments = [];
  const tagRe = /<(\w+)\b([^>]*)>([^<]*)/g;
  let m;
  while ((m = tagRe.exec(cleaned)) !== null) {
    const attrs = m[2] || "";
    const raw = decodeEntities(m[3]).replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const classMatch = attrs.match(/class\s*=\s*"([^"]*)"/i);
    const cls = classMatch ? classMatch[1].toLowerCase() : "";
    segments.push({ text: raw, cls });
  }
  if (!segments.length) return null;

  // Classify.
  let metaSeg = null;
  let titleSeg = null;
  let publisherSeg = null;

  for (const seg of segments) {
    if (!metaSeg && looksLikeMetaLine(seg.text)) metaSeg = seg;
  }
  for (const seg of segments) {
    if (seg === metaSeg) continue;
    if (/\bfont-bold\b|\btext-xl\b|\btext-md\b/.test(seg.cls) && !titleSeg) {
      titleSeg = seg;
    } else if (/\bitalic\b/.test(seg.cls) && !publisherSeg) {
      publisherSeg = seg;
    }
  }
  // Fallback: no class hints — pick the segment that ends in a year as
  // publisher, the longest remaining as title.
  if (!titleSeg) {
    const nonMeta = segments.filter((s) => s !== metaSeg && s !== publisherSeg);
    if (!publisherSeg) {
      publisherSeg = nonMeta.find((s) => /\b(19|20)\d{2}\b\s*$/.test(s.text)) || null;
    }
    const candidates = segments.filter((s) => s !== metaSeg && s !== publisherSeg);
    if (candidates.length) {
      titleSeg = candidates.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    }
  }
  // Author = first remaining segment with letters that isn't title/publisher/meta.
  let authorSeg = null;
  for (const seg of segments) {
    if (seg === metaSeg || seg === titleSeg || seg === publisherSeg) continue;
    if (/[A-Za-z一-鿿]/.test(seg.text)) { authorSeg = seg; break; }
  }

  const meta = parseMetaLine(metaSeg ? metaSeg.text : "");
  return {
    md5,
    title: titleSeg ? titleSeg.text : "(untitled)",
    authors: authorSeg ? authorSeg.text : "",
    publisher: publisherSeg ? publisherSeg.text : "",
    year: meta.year || extractYear(publisherSeg && publisherSeg.text) || "",
    ext: meta.ext || "",
    language: meta.language || "",
    size_bytes: meta.size_bytes || null,
    size_label: meta.size_label || "",
    detail_url: `${ANNAS_BASE}/md5/${md5}`,
  };
}

function looksLikeMetaLine(s) {
  const lower = s.toLowerCase();
  if (/\b\d+(?:\.\d+)?\s?(kb|mb|gb)\b/i.test(s)) return true;
  for (const ext of KNOWN_EXTS) {
    if (lower.includes(`, ${ext},`) || lower.includes(` ${ext},`) || lower.endsWith(` ${ext}`)) return true;
  }
  return false;
}

function parseMetaLine(line) {
  const out = { ext: "", language: "", size_bytes: null, size_label: "", year: "" };
  if (!line) return out;
  const lower = line.toLowerCase();

  for (const ext of KNOWN_EXTS) {
    const re = new RegExp(`(^|[\\s,/])${ext}([\\s,/]|$)`, "i");
    if (re.test(lower)) { out.ext = ext; break; }
  }

  const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s?(KB|MB|GB)/i);
  if (sizeMatch) {
    const n = Number(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    const mult = unit === "GB" ? 1e9 : unit === "MB" ? 1e6 : 1e3;
    out.size_bytes = Math.round(n * mult);
    out.size_label = `${sizeMatch[1]} ${unit}`;
  }

  const yearMatch = line.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) out.year = yearMatch[0];

  // Language tokens: "English [en]" or just "[en]" or "Chinese [zh]"
  const langMatch = line.match(/\[([a-z]{2}(?:-[A-Za-z]{2,4})?)\]/);
  if (langMatch) out.language = langMatch[1];

  return out;
}

function extractYear(s) {
  const m = String(s || "").match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : "";
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, " ");
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

// ----------------- Download ----------------------------------------------

async function downloadBook({ md5, dest_dir }) {
  if (!/^[a-f0-9]{32}$/i.test(String(md5 || ""))) {
    throw new Error("download_book: 'md5' must be a 32-char hex string");
  }
  const apiKey = process.env.ANNAS_ARCHIVE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "download_book: ANNAS_ARCHIVE_API_KEY is not set. Configure it via Settings → Plugins → Anna's Archive."
    );
  }

  const destBase = dest_dir
    || process.env.ANNAS_DOWNLOAD_DIR
    || path.join(os.tmpdir(), "annas-archive-downloads");
  await fs.mkdir(destBase, { recursive: true });

  // 1) Resolve a download URL through the Members fast-download API.
  const apiParams = new URLSearchParams({ md5, key: apiKey });
  const mirror = (process.env.ANNAS_DOWNLOAD_MIRROR || "").trim();
  if (mirror) apiParams.set("domain", mirror);
  const apiUrl = `${ANNAS_BASE}/dyn/api/fast_download.json?${apiParams.toString()}`;

  const apiResp = await fetchJson(apiUrl, {
    timeoutMs: 30000,
    redactInError: [apiKey],
  });

  if (apiResp.error) {
    throw new Error(`Anna's Archive API error: ${apiResp.error}`);
  }
  if (!apiResp.download_url) {
    throw new Error("Anna's Archive API returned no download_url. Your key may be out of daily downloads.");
  }

  // 2) Resolve metadata so we can name the file sensibly.
  const meta = await fetchBookMeta(md5).catch(() => null);
  const ext = (meta && meta.ext) || guessExtFromUrl(apiResp.download_url) || "bin";
  const safeTitle = sanitizeFilename((meta && meta.title) || md5);
  const filename = `${safeTitle}.${ext}`;
  const outPath = path.join(destBase, filename);

  // 3) Stream the file. The host plugin manager already enforces the network
  //    allowlist; we just write whatever bytes the resolved URL sends.
  const dlTimeoutMs = Number(process.env.ANNAS_DOWNLOAD_TIMEOUT_MS) || 180000;
  await streamToFile(apiResp.download_url, outPath, { timeoutMs: dlTimeoutMs });

  const stat = await fs.stat(outPath);
  return {
    file_path: outPath,
    md5,
    title: (meta && meta.title) || "",
    authors: (meta && meta.authors) || "",
    ext,
    size_bytes: stat.size,
    source_url: apiResp.download_url,
    daily_quota_left: apiResp.account_fast_download_info && apiResp.account_fast_download_info.downloads_left,
  };
}

async function fetchBookMeta(md5) {
  try {
    const html = await fetchText(`${ANNAS_BASE}/md5/${md5}`, { timeoutMs: 15000 });
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
    const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i);
    const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : "";
    const desc = descMatch ? decodeEntities(descMatch[1]).trim() : "";
    const meta = parseMetaLine(desc);
    return {
      title,
      authors: extractAuthorsFromDescription(desc),
      ext: meta.ext,
      language: meta.language,
      size_bytes: meta.size_bytes,
    };
  } catch {
    return null;
  }
}

function extractAuthorsFromDescription(desc) {
  // og:description typically reads "🚀/✅ EPUB, 1.4MB, 📘 Book (non-fiction), English [en], …"
  // Authors aren't always present; return "" if we can't be sure.
  return "";
}

function guessExtFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    const m = last.match(/\.([A-Za-z0-9]{2,5})(?:$|\?)/);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function sanitizeFilename(s) {
  return String(s)
    .replace(/[ -<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "untitled";
}

// ----------------- HTTP helpers ------------------------------------------

async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const resp = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { "User-Agent": userAgent(), Accept: "text/html,*/*;q=0.8" },
  });
  if (!resp.ok) {
    throw new Error(`GET ${redactUrl(url)} → HTTP ${resp.status}`);
  }
  return resp.text();
}

async function fetchJson(url, { timeoutMs = 20000, redactInError = [] } = {}) {
  const resp = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
  });
  const body = await resp.text();
  if (!resp.ok) {
    const safe = redactInError.reduce((s, v) => s.split(v).join("***"), body);
    throw new Error(`GET ${redactUrl(url)} → HTTP ${resp.status}: ${safe.slice(0, 400)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`GET ${redactUrl(url)} returned non-JSON body`);
  }
}

async function streamToFile(url, outPath, { timeoutMs = 180000 } = {}) {
  const resp = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { "User-Agent": userAgent() },
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Download ${redactUrl(url)} → HTTP ${resp.status}`);
  }
  const nodeStream = Readable.fromWeb(resp.body);
  await pipeline(nodeStream, createWriteStream(outPath));
}

async function fetchWithTimeout(url, { timeoutMs, headers }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

function redactUrl(url) {
  // Don't leak the api key into log lines.
  try {
    const u = new URL(url);
    if (u.searchParams.has("key")) u.searchParams.set("key", "***");
    return u.toString();
  } catch {
    return url;
  }
}

function userAgent() {
  return `annas-archive-mcp/0.1.0 (RNA plugin; +https://github.com/zeng4pi/annas_RNAPlugin)`;
}

// ----------------- MCP wiring --------------------------------------------

const TOOLS = [
  {
    name: "search_books",
    description:
      "Search Anna's Archive for books / papers matching a query. Returns up to `limit` result rows, each with an md5 hash that can be passed to download_book.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Free-text query: title, author, ISBN, DOI." },
        ext: {
          type: "string",
          description: "File-extension filter, e.g. 'epub', 'pdf'. Omit or pass 'any' to disable.",
        },
        language: {
          type: "string",
          description: "ISO 639-1 language code, e.g. 'en', 'zh'. Omit or pass 'any' to disable.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum results to return (default 10).",
        },
      },
    },
  },
  {
    name: "download_book",
    description:
      "Resolve a download URL via the Anna's Archive Members API using the configured key, then stream the file to disk. Returns the local file path plus basic metadata. Requires ANNAS_ARCHIVE_API_KEY.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["md5"],
      properties: {
        md5: {
          type: "string",
          pattern: "^[a-fA-F0-9]{32}$",
          description: "32-char hex md5 of the chosen result, as returned by search_books.",
        },
        dest_dir: {
          type: "string",
          description:
            "Directory the file should land in. Defaults to ANNAS_DOWNLOAD_DIR env var, then to a tmp dir.",
        },
      },
    },
  },
];

function buildServer() {
  const server = new Server(
    { name: "annas-archive", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params || {};
    try {
      let result;
      if (name === "search_books") result = await searchBooks(args);
      else if (name === "download_book") result = await downloadBook(args);
      else throw new Error(`Unknown tool: ${name}`);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: String(err && err.message || err) }],
      };
    }
  });

  return server;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Expose internals for smoke tests (`import { ... } from "./server.js"`).
export { searchBooks, downloadBook, parseSearchHtml, parseMetaLine, sanitizeFilename };

const isEntry =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${path.resolve(process.argv[1] || "")}`;
if (isEntry) {
  main().catch((err) => {
    process.stderr.write(`annas-archive-mcp: fatal: ${err && err.stack || err}\n`);
    process.exit(1);
  });
}
