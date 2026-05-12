# annasRNAPlugin

A community plugin for the [RNA](https://github.com/byenat/RNA) reading agent that finds and imports ebooks and academic papers from external archive sources into your local reading library.

> ## ⏳ Status: pending RNA plugin runtime v1.0
>
> **This plugin is not installable yet.** RNA's plugin runtime is under active development upstream. Once the runtime reaches v1.0 (manifest parser + installer + capability enforcement + Settings UI), installation instructions will be added here.
>
> Watch / star this repo to get a release notification when install becomes available.

> ## 🙋 Looking for a long-term community maintainer
>
> The author of this initial scaffolding **does not plan to maintain this plugin long-term**. The goal is to seed an extraction artifact that a willing community contributor can take over once RNA users start adopting it.
>
> If you're interested, please open a [Maintainer application](../../issues/new?template=maintainer-application.md) issue. Ownership will be transferred via GitHub Transfer Ownership once a suitable maintainer is identified — see the pinned issue for the full transfer plan.

---

## What this plugin will do (planned, once installable)

The plugin will compose two things into a single installable unit:

1. **A search + download MCP server** — a thin wrapper around an upstream third-party CLI binary that talks to external archive sources. The binary is fetched directly from its upstream GitHub release at install time; **this repo does not redistribute any third-party binary**.
2. **A skill** — instructs the RNA agent how to chain `search → download → register-to-reader-library`.

End-user experience (future):

> **User**: "Find me a copy of <title> in EPUB"
>
> **RNA agent** (silently): searches archives → downloads → registers in Reader library → reports back
>
> **User**: opens the book in RNA's Reader tab.

The user never sees any of the internal MCP / skill plumbing — they just get the book.

---

## Installation (placeholder)

Once RNA plugin runtime v1.0 ships, installation is expected to look approximately like:

```bash
# Subject to change — exact CLI will follow RNA upstream's runtime contract
rna plugin install gh:zeng4pi/annasRNAPlugin
```

On install, RNA will:

1. Fetch the plugin manifest from this repo
2. Display all requested permissions (network access, filesystem write scope, third-party binary fetch source)
3. **Prompt you to enter your own account credential** for the upstream archive service — stored in your OS Keychain, never transmitted to this plugin's maintainer or to the RNA project
4. Download the third-party CLI binary directly from its upstream GitHub release (with checksum verification)
5. Register the skill so the RNA agent can use the new tool chain

You can `rna plugin uninstall` to remove all traces (binary, configuration, keychain entry, skill).

---

## Legal & Responsibility

- This plugin is a **community contribution**, distributed AS IS under the MIT license, with no warranty.
- The plugin **does not** redistribute any third-party binary, copyrighted content, or service credentials. All third-party software is fetched from its upstream release at install time; all credentials are supplied by you.
- You are responsible for the legality of how you use this plugin **in your jurisdiction**. Some archive sources operate in jurisdictions where the copyright status of certain materials varies; you should review applicable local law before using the plugin.
- This plugin is **not affiliated with** the RNA upstream project ([byenat](https://github.com/byenat)), any commercial entity, or any specific archive service. It is a third-party community plugin.

---

## Development

The plugin manifest format follows the [RNA Plugin Composition Spec](https://github.com/byenat/RNA/blob/main/docs/Plugin_Composition_Spec_v1.md). Until the upstream runtime is finalized, the in-repo manifest may not exist yet — it will be added once the spec / runtime stabilize and a working install flow can be validated end-to-end.

To contribute (once development resumes):

1. Open an issue first — for non-trivial changes, discuss before implementing.
2. Standard fork + PR workflow.
3. Commits should be GPG / SSH signed where possible (the eventual maintainer may enforce this).

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 zeng4pi
