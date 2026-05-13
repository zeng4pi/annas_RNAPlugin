# Changelog

All notable changes to this plugin will be documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-05-12

### Added

- `plugin.yaml` manifest conforming to RNA [Plugin Composition Spec v1.2](https://github.com/byenat/RNA/blob/main/docs/Plugin_Composition_Spec_v1.md). One surfaced skill (`annas-fetch-book`) + one stdio MCP server (`annas-archive`). Permissions, BYOK key, and plugin preferences all declared explicitly.
- `skills/fetch-book.skill.md` — skill that orchestrates `search → download → register-to-reader-library` against the bundled MCP server. Declares `invoke.mcp.server:annas-archive`, `network.allowlist:annas-archive.org`, and `write.hinata` capability scopes.
- `mcp/annas-archive/` — Node.js stdio MCP server (`@modelcontextprotocol/sdk`). Exposes `search_books` (scrapes Anna's Archive search HTML, no auth) and `download_book` (calls the Members fast-download API with the user's key, streams the file to disk). Filename and metadata harvested from the book's `/md5/<hash>` page.
- `mcp/annas-archive/smoke.js` — offline parser test.
- `mcp/annas-archive/handshake-test.js` — spawn-the-server smoke test verifying MCP `initialize` + `tools/list` + a graceful tool error when the API key is missing.
- `docs/ARCHITECTURE.md` — component diagram, tool contracts, capability scopes, invariant compliance, failure modes.

### Notes

- Plugin runtime is **not** yet installable upstream. This release lays down the source artifacts so they're ready when RNA plugin runtime v1.0 ships.
- This repo **does not** redistribute any third-party binary or copyrighted content. The MCP server is original code; downloaded bytes come from Anna's Archive at runtime, authenticated with the user's own paid Members API key.

## [0.0.0] — 2026-05-12

### Added

- Initial repo skeleton: README, LICENSE, `.gitignore`, GitHub issue templates.
