# annasRNAPlugin

A community plugin for the [RNA](https://github.com/byenat/RNA) reading agent that finds and imports ebooks and academic papers from [Anna's Archive](https://annas-archive.org) into your local Reader library.

> ## ⏳ Status: v0.1 scaffold — awaiting RNA plugin runtime v1.0
>
> The plugin's source (manifest + skill + MCP server) is in place and the MCP server is independently runnable. **You cannot install it into RNA yet** because the upstream runtime that loads `plugin.yaml` is still under development. Once RNA ships plugin runtime v1.0 (manifest parser + installer + capability enforcement + Settings UI), this README will gain a concrete install command.
>
> Watch / star this repo to get a release notification.

> ## 🙋 Looking for a long-term community maintainer
>
> The author of this initial scaffolding **does not plan to maintain this plugin long-term**. The goal is to seed an extraction artifact that a willing community contributor can take over once RNA users start adopting it.
>
> If you're interested, please open a [Maintainer application](../../issues/new?template=maintainer-application.md) issue. Ownership will be transferred via GitHub Transfer Ownership once a suitable maintainer is identified — see the pinned issue for the full transfer plan.

---

## What this plugin does

```
User in Chat: "Find me a copy of <title> in EPUB"
        │
        ▼
RNA main agent loads skill `annas-fetch-book` (this plugin)
        │
        ├─► annas-archive MCP `search_books`  →  list of candidates (md5, title, ext, size)
        │
        ├─► annas-archive MCP `download_book` →  file written to plugin workspace
        │       (uses your Members API key via fast-download API)
        │
        └─► RNA reader_import command         →  HiNATA `reader_imported_book` in Reader inbox
        │
        ▼
User opens the book in RNA's Reader tab.
```

The user never types Anna's md5 hashes, picks mirrors, or copies files around — they just get the book.

The plugin packages **one skill + one MCP server**. It does NOT redistribute any third-party binary or content; all bytes come from Anna's Archive at runtime, fetched with your own paid Members API key.

---

## Layout

```
.
├── plugin.yaml                       # RNA manifest (Plugin_Composition_Spec_v1)
├── skills/
│   └── fetch-book.skill.md           # surfaced skill: search → download → import
├── mcp/
│   └── annas-archive/                # stdio MCP server (Node.js, no third-party binary)
│       ├── server.js                 # search_books + download_book tools
│       ├── smoke.js                  # offline HTML-parser test
│       ├── handshake-test.js         # MCP initialize + tools/list round-trip
│       ├── package.json
│       └── README.md
└── docs/
    └── ARCHITECTURE.md               # how the pieces fit together
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

---

## Installation (placeholder)

Once RNA plugin runtime v1.0 ships, installation is expected to look approximately like:

```bash
# Subject to change — exact CLI will follow RNA upstream's runtime contract
rna plugin install gh:zeng4pi/annasRNAPlugin
```

On install, RNA will:

1. Fetch the manifest and validate it against the [plugin manifest schema](https://github.com/byenat/RNA/blob/main/docs/plugin_manifest.schema.json).
2. Display the requested permissions: network access to `annas-archive.org` (and two mirrors), filesystem scopes (`plugin_workspace`, `user_downloads`), and the `ANNAS_ARCHIVE_API_KEY` BYOK requirement.
3. **Prompt you for your Anna's Archive Members API key** — stored in your OS Keychain, never transmitted to this plugin's maintainer or to the RNA project. Get a key at <https://annas-archive.org/account>.
4. Start the MCP server and register the skill with RNA's main agent.

You can `rna plugin uninstall` to remove the plugin, its workspace, and the keychain entry. Books you already imported stay in your Reader library (they're your HiNATA, not the plugin's — see [RNA invariant (f)](https://github.com/byenat/RNA/blob/main/docs/Plugin_Composition_Spec_v1.md#invariant-f--可干净卸载)).

---

## Running the MCP server standalone (for development)

You don't need RNA to verify the MCP server works:

```bash
cd mcp/annas-archive
npm install
chmod +x server.js
node smoke.js              # parser test, no network
node handshake-test.js     # spawns the server, verifies MCP initialize + tools/list
export ANNAS_ARCHIVE_API_KEY="<your key>"   # only required for download_book
node server.js             # speaks MCP stdio; drive with any MCP client
```

See [`mcp/annas-archive/README.md`](mcp/annas-archive/README.md) for the tool I/O contracts.

---

## Legal & Responsibility

- This plugin is a **community contribution**, distributed AS IS under the MIT license, with no warranty.
- The plugin **does not** redistribute any third-party binary, copyrighted content, or service credentials. All bytes flow from Anna's Archive at request time, authenticated with your own paid Members API key.
- You are responsible for the legality of how you use this plugin **in your jurisdiction**. Anna's Archive aggregates shadow-library content whose copyright status varies; review applicable local law before using.
- This plugin is **not affiliated with** the RNA upstream project ([byenat](https://github.com/byenat)), Anna's Archive, or any commercial entity.

---

## Development

The manifest follows the [RNA Plugin Composition Spec v1.2](https://github.com/byenat/RNA/blob/main/docs/Plugin_Composition_Spec_v1.md). The current scaffold passes the published [`plugin_manifest.schema.json`](https://github.com/byenat/RNA/blob/main/docs/plugin_manifest.schema.json).

To contribute:

1. Open an issue first — for non-trivial changes, discuss before implementing.
2. Standard fork + PR workflow.
3. Run the two local checks before pushing:
   ```bash
   cd mcp/annas-archive && node smoke.js && node handshake-test.js
   ```
4. Commits should be GPG / SSH signed where possible (the eventual maintainer may enforce this).

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 zeng4pi
