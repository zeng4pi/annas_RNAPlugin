---
name: annas-fetch-book
description: Find a book or paper on Anna's Archive and import it into the user's RNA Reader library. Triggered by requests like "find me <title>", "download the <author> book on <topic>", "get the EPUB of <title>".
surfaced: true
auto_invoke: true
argument_hint: "<title or author or topic> [--format=epub|pdf|...] [--lang=en|zh|...]"
propose_origin: builtin
capability_request:
  - invoke.mcp.server:annas-archive
  - network.allowlist:annas-archive.org
  - write.hinata
---

# Skill: Fetch a book from Anna's Archive

## When to use

The user is asking RNA to **obtain a specific book, paper, or document** rather than
to discuss content they already have. Typical phrasings:

- "Find me a copy of <title>."
- "Can you get the EPUB of <title> by <author>?"
- "Download the latest edition of <textbook>."
- "I need <paper title> as a PDF."

If the user is asking a question *about* a book that is already in their library,
**do not use this skill** — answer from existing HiNATA instead.

## Tools you have

This skill is paired with the `annas-archive` MCP server, which exposes:

- **`search_books`** — `{ query, ext?, language?, limit? } → { results: [{ md5, title, authors, year, publisher, ext, size_bytes, language, source }] }`
- **`download_book`** — `{ md5, dest_dir? } → { file_path, title, authors, ext, size_bytes, source_url }`

The user's preferred format and language are available in plugin config
(`preferred_format`, `preferred_language`, `max_results`). Use them as defaults
unless the user overrides explicitly in the request.

## Flow

1. **Parse the intent.** Extract the title / author / topic from the user's
   message. If the user gave a format or language (`as EPUB`, `in Chinese`),
   capture it; otherwise apply config defaults.

2. **Search.** Call `search_books` with the parsed query plus `ext` and
   `language` filters. Cap `limit` at `max_results`.

   - If `results` is empty, retry once without the language filter, then
     once without the ext filter. If still empty, tell the user nothing
     was found and stop — do not download a random adjacent result.

3. **Disambiguate if needed.** If there is more than one plausible match
   (different authors, different editions, very different file sizes),
   show the top 3-5 as a short numbered list with author + year + format
   + size, and ask which one. **Do not auto-pick** when the top two
   results differ on author or edition.

   If there is one clear winner (same title + same author + matches format
   preference, file size 0.1-100 MB), proceed without asking.

4. **Download.** Call `download_book` with the chosen `md5`. The MCP server
   uses the user's Members API key (already provisioned at plugin install)
   to resolve a download URL and stream the file to the plugin workspace.

   - If `download_book` returns an authentication error, surface it
     verbatim and tell the user to check their key in
     Settings → Plugins → Anna's Archive. Do not retry.
   - If it returns a rate-limit error, tell the user and stop.

5. **Register with the Reader.** Hand the returned `file_path` to RNA's
   book-import command so it lands as a HiNATA with
   `origin_type: reader_imported_book` (the standard Reader EPUB root, see
   `HiNATA_Data_Model_Spec_v1 §2.1`). The agent does this through whichever
   `reader_import_*` tool the host runtime exposes — do not write substrate
   directly.

6. **Report.** One short line: title, author, format, where it landed.
   Example: *"Imported 'The Selfish Gene' by Richard Dawkins (EPUB, 1.4 MB)
   into your Reader inbox."* Do not paste search-result tables or download
   URLs in the final confirmation.

## Boundaries

- This skill is **single-user** (Invariant c). Never offer to share the
  downloaded file or send it elsewhere.
- All network calls go through the `annas-archive` MCP server, which is
  wrapped by RNA's `Minimum Necessary Send` chain (Invariant d). Do not
  attempt to bypass it with raw HTTP.
- Downloaded files belong to the user. If the plugin is later uninstalled,
  the imported book stays in the user's Reader library (Invariant f).
- You are not a legal advisor. If the user asks whether a specific download
  is lawful for them, say it depends on their jurisdiction and the work's
  copyright status, and decline to advise further.

## Failure responses

| Situation | Response |
|---|---|
| API key missing/invalid | "Your Anna's Archive key isn't set or was rejected. Settings → Plugins → Anna's Archive → enter key." |
| No results after fallback | "I couldn't find anything matching '<query>' on Anna's Archive." |
| File too large (>100 MB and not explicitly asked for) | Confirm with the user before downloading. |
| Download stalled / timeout | "Download didn't finish in time. Want me to try a different mirror or a smaller edition?" |
