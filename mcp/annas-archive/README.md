# `annas-archive` MCP server

Tiny stdio MCP server that the [Anna's Archive · RNA](../../README.md) plugin
ships with. Exposes two tools to the RNA main agent:

| Tool | Purpose | Auth |
|---|---|---|
| `search_books` | Query Anna's Archive search and return rows with md5 hashes | None |
| `download_book` | Resolve a download URL via the Members fast-download API, stream the file to disk | `ANNAS_ARCHIVE_API_KEY` (required) |

## Run locally

```bash
cd mcp/annas-archive
npm install
chmod +x server.js
export ANNAS_ARCHIVE_API_KEY="<your-members-key>"   # only needed for download_book
node server.js   # speaks MCP stdio — drive it with an MCP client
```

Smoke-test the HTML parser without hitting the network:

```bash
node smoke.js
```

## Env / `user_config`

The RNA plugin manager injects these from `plugin.yaml` `mcp_servers[].user_config`:

| Variable | Purpose |
|---|---|
| `ANNAS_ARCHIVE_API_KEY` | Members API key. Required for `download_book`. Get one at <https://annas-archive.org/account>. |
| `ANNAS_DOWNLOAD_DIR` | Optional. Directory the downloaded file is written to. Defaults to a tmpdir. |
| `ANNAS_DOWNLOAD_MIRROR` | Optional. `domain` query passed to the fast-download API (e.g. `lgrsfi`). Leave blank to let Anna's Archive choose. |
| `ANNAS_SEARCH_TIMEOUT_MS` | Optional. Search HTTP timeout. Defaults to 20000. |
| `ANNAS_DOWNLOAD_TIMEOUT_MS` | Optional. File-download timeout. Defaults to 180000. |

The key is never logged. URLs printed to stderr have the `key=` query param
redacted before they leave this process.

## Tool I/O

### `search_books`

```jsonc
// input
{ "query": "selfish gene dawkins", "ext": "epub", "language": "en", "limit": 5 }

// output
{
  "results": [
    {
      "md5": "00112233445566778899aabbccddeeff",
      "title": "The Selfish Gene",
      "authors": "Richard Dawkins",
      "publisher": "Oxford University Press 1976",
      "year": "1976",
      "ext": "epub",
      "language": "en",
      "size_bytes": 1400000,
      "size_label": "1.4 MB",
      "detail_url": "https://annas-archive.org/md5/00112233445566778899aabbccddeeff"
    }
  ]
}
```

### `download_book`

```jsonc
// input
{ "md5": "00112233445566778899aabbccddeeff" }

// output
{
  "file_path": "/var/folders/.../annas-archive-downloads/The Selfish Gene.epub",
  "md5": "00112233445566778899aabbccddeeff",
  "title": "The Selfish Gene",
  "ext": "epub",
  "size_bytes": 1428340,
  "source_url": "https://lgrsfi.example/.../selfish-gene.epub",
  "daily_quota_left": 19
}
```

## Known limitations

- The HTML parser is heuristic: Anna's Archive can change markup at any time.
  If `search_books` returns empty or garbled results, the fix is updating
  `parseResultBlock` / `parseMetaLine` in `server.js`.
- Author extraction from the book detail page (`og:description`) is not
  reliable — the field returns an empty string when uncertain rather than
  guessing.
- The Members fast-download API has a daily download quota. The server
  surfaces `daily_quota_left` so the agent can warn the user before
  exhausting it.
