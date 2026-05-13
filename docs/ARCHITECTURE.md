# Architecture

This is the v0.1 scaffold of the **Anna's Archive · RNA** plugin. It composes two RNA primitives — a **Skill** and an **MCP server** — under a single `plugin.yaml`, so that an RNA user asking "find me a copy of <title>" gets the book imported into their Reader library without ever seeing the search / download / register plumbing.

## §1 — Components

```
┌───────────────────────────────────────────────────────────────┐
│  RNA main agent                                               │
│                                                               │
│   ┌──────────────────────────────────────────────────────┐    │
│   │ Skill: annas-fetch-book   (skills/fetch-book.skill.md)│    │
│   │   - When user wants a specific book → run this flow  │    │
│   │   - Capabilities requested:                          │    │
│   │       invoke.mcp.server:annas-archive                │    │
│   │       network.allowlist:annas-archive.org            │    │
│   │       write.hinata                                   │    │
│   └──────────────────────────────────────────────────────┘    │
│                          │                                    │
│                          │ tool calls (MCP)                   │
│                          ▼                                    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │ MCP server: annas-archive (stdio, Node 20+)          │    │
│   │   server.js exposes 2 tools:                         │    │
│   │     - search_books({query, ext?, lang?, limit?})     │    │
│   │     - download_book({md5, dest_dir?})                │    │
│   │   No third-party binary; pure Node + built-in fetch. │    │
│   └──────────────────────────────────────────────────────┘    │
│                          │                                    │
│                          ▼                                    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │ RNA reader_import_* command (host runtime, not us)   │    │
│   │   Creates HiNATA with origin_type: reader_imported_book│  │
│   │   (HiNATA_Data_Model_Spec_v1 §2.1)                   │    │
│   └──────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
                           │
                           ▼
                  https://annas-archive.org
                  (members fast-download API)
```

Everything between the user's chat message and the imported HiNATA happens inside the main agent — there is no new agent and no new top-level UI surface (Plugin Composition Spec invariants a / e).

## §2 — Why a Skill + MCP, not an Extension

The decision tree in [Plugin Developer Guide §2](https://github.com/byenat/RNA/blob/main/docs/Plugin_Developer_Guide_v1.md) says:

- Need host-side native code? → Extension required.
- Need external data / tools? → MCP server required.

We need external data (Anna's Archive search + download) but **no native code**: streaming an HTTP download to a file is something the MCP server can do in pure Node.js. So the plugin contains zero Extensions, which keeps it runtime-portable (works on RNA browser / desktop / mobile runtimes, not just desktop) and keeps the install consent dialog short.

## §3 — Tool contracts

### `search_books`

```jsonc
// input
{ "query": "selfish gene", "ext": "epub", "language": "en", "limit": 5 }

// output (results truncated to demonstrate)
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

Search is anonymous (no API key needed). The server scrapes the public `annas-archive.org/search` HTML and parses out result rows. Parser is intentionally defensive; see "Failure modes" below.

### `download_book`

```jsonc
// input
{ "md5": "00112233445566778899aabbccddeeff" }

// output
{
  "file_path": "/path/to/workspace/The Selfish Gene.epub",
  "md5": "00112233445566778899aabbccddeeff",
  "title": "The Selfish Gene",
  "ext": "epub",
  "size_bytes": 1428340,
  "source_url": "https://lgrsfi.example/.../selfish-gene.epub",
  "daily_quota_left": 19
}
```

Download requires the user's Members API key (`ANNAS_ARCHIVE_API_KEY`). The flow is:

1. `GET https://annas-archive.org/dyn/api/fast_download.json?md5=<md5>&key=<key>` returns a JSON object containing `download_url`.
2. The MCP server streams that URL to disk in a directory chosen by `dest_dir` → `ANNAS_DOWNLOAD_DIR` env → tmpdir.
3. Filename is `<sanitized-title>.<ext>`, sourced from the book's `/md5/<hash>` detail page.

The skill then hands `file_path` to whatever `reader_import_*` tool the host runtime exposes; that's the step that creates the HiNATA. The MCP server does NOT write to the substrate.

## §4 — Capability scopes & permissions

| Where | What | Why |
|---|---|---|
| `plugin.yaml` `permissions.network` | `https://annas-archive.org/` + two mirrors | Anna's front-end. Mirrors used by some download URLs are listed; rotating mirrors may need to be added at runtime by the user. |
| `plugin.yaml` `permissions.filesystem` | `plugin_workspace`, `user_downloads` | Where downloaded files land before the Reader picks them up. |
| `plugin.yaml` `permissions.byok_keys` | `ANNAS_ARCHIVE_API_KEY` | The Members API key. Stored in OS keychain at install time. |
| Skill `capability_request` | `invoke.mcp.server:annas-archive` | Restricts the skill to *this* server, no others. |
| Skill `capability_request` | `network.allowlist:annas-archive.org` | Defense-in-depth: even if the MCP server were swapped, the skill can only steer the agent toward this host. |
| Skill `capability_request` | `write.hinata` | Final import step creates a new `reader_imported_book` HiNATA. |

## §5 — Plugin Composition invariants (§6 of the spec)

| # | Invariant | How this plugin complies |
|---|---|---|
| a | No fork of main agent | We add one skill and one MCP server. No sub-agent is registered. |
| b | No bypass of HiNATA | The downloaded file becomes a `reader_imported_book` HiNATA via the host's reader-import command. The plugin never opens its own database. |
| c | No user-to-user channel | Single-user only. The skill explicitly refuses to "share" downloaded files. |
| d | No bypass of Minimum Necessary Send | All outbound traffic goes through the MCP server, which the plugin manager wraps with RNA's filter / desensitize / policy chain. No raw `fetch` in the skill body. |
| e | No new top-level tab | Skill is invoked via Chat (slash `/annas:fetch-book` or natural language). |
| f | Cleanly uninstallable | Disable stops the MCP server and deregisters the skill. Uninstall removes the workspace and keychain entry. Previously-imported books are user HiNATA and survive. |

## §6 — Failure modes & how the scaffold handles them

| Failure | Surface |
|---|---|
| HTML markup at annas-archive.org changes and the parser starts returning empty rows | Caught by the skill: if results are empty, it retries with relaxed filters before reporting "not found". Long-term fix is updating `parseResultBlock` in `server.js`. |
| Members API key missing / invalid | `download_book` returns an MCP tool error verbatim; skill instructs the user to re-enter the key. |
| Daily download quota exhausted | API returns `error`; skill surfaces "key may be out of daily downloads". |
| Download stalls / times out | Configurable via `ANNAS_DOWNLOAD_TIMEOUT_MS` (default 180s). Skill offers to retry on a different mirror via `ANNAS_DOWNLOAD_MIRROR`. |
| Reader-import command unavailable in this runtime version | Skill stops at the downloaded file and tells the user the file is on disk but couldn't be auto-registered. |

## §7 — Out of scope for v0.1

- **Per-result author extraction.** The book detail page's `og:description` is not consistent across rows. The current scaffold returns the author when the search-result block surfaces it, and otherwise leaves the field blank rather than guessing.
- **Mirror rotation.** When the API returns a URL on an unexpected host, the host plugin manager's network allowlist will reject the fetch. The README explains that the user can extend the allowlist at runtime; we don't try to auto-discover mirrors.
- **Bulk import.** The skill imports one book per invocation. A list-import variant can be added later as a second surfaced skill.
- **Caching.** No search-result caching. Each invocation goes to Anna's Archive.

## §8 — Local development loop

```bash
cd mcp/annas-archive
npm install
node smoke.js           # ≈ 0.1 s — verify the HTML parser hasn't drifted
node handshake-test.js  # ≈ 1 s   — verify the MCP server boots and lists tools
ANNAS_ARCHIVE_API_KEY=... node server.js  # drive interactively via an MCP client
```

When you change the skill, no rebuild is needed; the plugin manager re-reads `skills/*.skill.md` on enable.

When you change the manifest, the plugin manager will re-validate it on reinstall against `plugin_manifest.schema.json`.
