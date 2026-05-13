#!/usr/bin/env node
// Smoke test for the parser — no network. Feeds a snippet that mimics the
// Anna's Archive search-result HTML shape and asserts the parser pulls out
// md5 / title / ext / size. Run with `node smoke.js`.

import assert from "node:assert/strict";
import { parseSearchHtml, parseMetaLine, sanitizeFilename } from "./server.js";

const FIXTURE = `
<html><body>
<div>
  <a href="/md5/00112233445566778899aabbccddeeff" class="custom-a">
    <div class="text-xl font-bold">The Selfish Gene</div>
    <div class="truncate italic">Oxford University Press 1976</div>
    <div class="truncate text-sm">Richard Dawkins</div>
    <div class="text-xs">English [en], epub, 1.4MB, 📘 Book</div>
  </a>
</div>
<div>
  <a href="/md5/ffeeddccbbaa99887766554433221100" class="custom-a">
    <div class="text-xl font-bold">Some Paper</div>
    <div class="text-xs">Chinese [zh], pdf, 820KB</div>
    <div class="truncate text-sm">Author Two</div>
  </a>
</div>
<a href="/md5/00112233445566778899aabbccddeeff">dup, should be filtered</a>
</body></html>
`;

const rows = parseSearchHtml(FIXTURE, 5);

assert.equal(rows.length, 2, "should dedupe duplicate md5");
assert.equal(rows[0].md5, "00112233445566778899aabbccddeeff");
assert.equal(rows[0].title, "The Selfish Gene");
assert.equal(rows[0].ext, "epub");
assert.equal(rows[0].language, "en");
assert.equal(rows[0].size_bytes, 1_400_000);
assert.equal(rows[0].year, "1976");

assert.equal(rows[1].md5, "ffeeddccbbaa99887766554433221100");
assert.equal(rows[1].ext, "pdf");
assert.equal(rows[1].language, "zh");
assert.equal(rows[1].size_bytes, 820_000);

const meta = parseMetaLine("English [en], epub, 1.4MB, 📘 Book");
assert.equal(meta.ext, "epub");
assert.equal(meta.language, "en");
assert.equal(meta.size_bytes, 1_400_000);

assert.equal(sanitizeFilename("Hello / World: v2"), "Hello _ World_ v2");
assert.equal(sanitizeFilename(""), "untitled");

console.log("OK — parser smoke test passed (%d rows).", rows.length);
