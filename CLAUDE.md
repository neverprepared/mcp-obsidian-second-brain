# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A **Model Context Protocol (MCP) server** (`@neverprepared/mcp-obsidian-second-brain`) that exposes an
Obsidian vault as a structured second-brain memory system. It runs as a stdio process; the MCP host
(e.g. Claude Desktop / Claude Code) communicates over stdin/stdout. The same handlers are also reachable
from a plain CLI (`obsidian-mem`) for shell hooks and scripts.

TypeScript, ESM (`"type": "module"`), Node >= 18. Storage is Markdown + YAML frontmatter on disk, with
SQLite sidecar indexes (FTS5 + sqlite-vec) under `_index/`.

## Commands

```bash
npm run dev           # Run the MCP server with tsx (no build)
npm run build         # Compile TypeScript to dist/ (postbuild chmod +x on the two bins)
npm start             # Run the compiled server (node dist/index.js)
npm run typecheck     # Type-check without emitting
npm test              # Run all tests once (vitest)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

Run a single test file:
```bash
npx vitest run tests/vault/naming.test.ts
```

There is no lint script — `npm run typecheck` is the static gate. CI (`.github/workflows/ci.yml`) runs
`npm ci --ignore-scripts` → `npm rebuild better-sqlite3` → typecheck → test → build on Node 20.
Releases are automated by release-please (`release-please.yml`) and published by `publish.yml`.

Debian packaging lives in the `Makefile` (`make package`, or `make package-docker` to cross-build from
macOS via an Ubuntu container — `better-sqlite3` ships a native `.node` binary, so the host OS matters).

## Entry points

| File | Role |
|---|---|
| `src/index.ts` | `bin: mcp-obsidian-second-brain` — starts the MCP stdio server |
| `src/cli.ts` | `bin: obsidian-mem` — argv-driven access to the same handlers; JSON on stdout, logs on stderr |
| `src/server.ts` | MCP wiring: `ListTools` / `CallTool` handlers, stdio transport, SIGINT/SIGTERM shutdown |
| `src/core/index.ts` | Stable non-MCP API surface: `initialize()`, `shutdown()`, re-exported tool handlers |
| `src/tools/index.ts` | The tool registry — `getToolDefinitions()` + the `handlers` name→function map |

`src/para/structure.ts` and `src/para/categories.ts` are legacy shims/leftovers from the earlier PARA
layout; `ensureVaultStructure` really lives in `src/vault/structure.ts`.

## Environment

Copy `.env.example` and set:
- `OBSIDIAN_VAULT_PATH` — path to the Obsidian vault directory (default: `~/workspaces/profiles/personal/obsidian/vaults/memory`)
- `MCP_SB_LOG_LEVEL` — `debug | info | warn | error` (default: `info`). All logs go to **stderr** so they don't interfere with MCP stdio transport. `LOG_LEVEL` is accepted as a fallback.
- `OLLAMA_BASE_URL` (default `http://localhost:11434`), `EMBEDDING_MODEL` (default `nomic-embed-text`), `EMBEDDING_DIMS` (default `768`), `EMBEDDING_BATCH_SIZE` (default `50`) — vector embeddings are produced by a local Ollama. If Ollama is unreachable, embedding is skipped and search degrades to FTS5-only.

All other tunables (folder names, limits, Jaccard threshold, TTL defaults) are compile-time constants in
`src/config.ts`.

## Startup sequence (`initialize()` in `src/core/index.ts`)

1. `ensureVaultStructure()` — create layer folders + system folders if missing
2. `initVectorIndex()` — open/create `_index/vectors.db` (sqlite-vec)
3. `buildIndex()` — scan `Memory/` atoms and `Wiki/` pages into in-memory indexes; rebuild FTS5
4. `recoverInflightRename()` — replay a crashed slug rename from the rename journal (idempotent)
5. `ensureWorkingDb()` — open/create the per-session `_index/wm-<PID>.sqlite`
6. `syncVectorIndex()` — background embedding backfill (lock-guarded via `_index/sync.lock`)

`shutdown()` snapshots working memory to JSON. The MCP server calls it on SIGINT/SIGTERM; the CLI calls
it in a `finally`.

## Four-layer vault structure

```
<VAULT_PATH>/
├── Input/          ← raw sources, immutable after ingest (articles, docs, transcripts, notes)
├── Memory/         ← atoms: short, factual, machine-indexed (FTS5 + vector)
├── Wiki/           ← long-form synthesis (HowTos, Runbooks, References, Scratch)
├── Output/         ← deliverables for external consumption (articles, reports, decks)
├── _daily/         ← atom creation log (daily rotation)
├── _index/         ← vectors.db, wm-<PID>.sqlite, sync.lock
├── _log/           ← append-only provenance log
└── _templates/
```

**Storage decision:**

| Content | Layer | Tool |
|---|---|---|
| Short factual finding, conclusion, ages out | `Memory/` atom | `memory_store` |
| Long-form synthesis, procedure, framework, runbook | `Wiki/` page | `wiki_write` |
| Deliverable for external consumption | `Output/` | `output_write` |
| Raw source material | `Input/` | `input_ingest` |

## Retrieval protocol

Always start with `memory_search`. Results are ranked by hybrid score (RRF of FTS5 BM25 + vector KNN).

- **Atom result** — has `ID:` field. Use `memory_recall` for full content.
- **Wiki result** — prefixed `[Wiki]`, has `Path:` field. Use `wiki_read` with the path for full content.

```
1. memory_search(query)
      ├─ atom result  → memory_recall(id) if full content needed
      └─ [Wiki] result → wiki_read("HowTos/oauth-setup.md")
```

Wiki pages surface alongside atoms in the same search — no separate wiki search step needed. Wiki pages
are never stale and are excluded from `freshness: stale` queries.

`memory_search` **without** a `query` is the listing/browse mode (filters + sorting); there is no
separate list tool. Archived atoms are excluded unless `include_archived: true`.

## Memory atom format

Each atom is a markdown file in `Memory/<slug>.md` with YAML frontmatter (schema: `src/schemas/frontmatter.ts`):

```yaml
id: <nanoid-from-slug>
title: "..."
lifecycle_status: active | reference | archive
tags: [...]
created: <ISO>
updated: <ISO>
source: conversation | manual | import
related: [slug1, slug2]
confidence: low | medium | high
status: active | stale | archived
last_accessed: <ISO>
source_urls: [...]
input_sources: []     # Input/ files this atom was synthesized from
wiki_refs: []         # Wiki/ pages this atom grounds
ttl_days: <number>
deadline: <ISO>       # optional
```

Default TTL by lifecycle status (`DEFAULT_TTL_DAYS`): active 90, reference 180, archive 365 days.

## Search indexes (`src/vault/search.ts`)

Two parallel in-memory indexes, both backed by the shared `fts_memories` FTS5 table and the
`vec_embeddings` vector store in `_index/vectors.db`:

- **`memoryIndex`** — `Map<id, IndexEntry>` for atoms. Key is the atom `id` (e.g. `mem_123_slug`).
- **`wikiIndex`** — `Map<"wiki:<relPath>", WikiIndexEntry>` for Wiki pages, `wiki:`-prefixed to namespace it from atom ids.

`buildIndex()` walks both `Memory/` and `Wiki/` and populates both maps + FTS.
`wiki_write` / `wiki_delete` / `wiki_move` call `indexWikiEntry` / `removeWikiFromIndex` so the wiki
index stays in sync on every mutation.

Wiki pages are excluded from: auto-linking (Jaccard), the cluster map (`Memory/_index.md`),
`freshness: stale`, `lifecycle_status`, and `status` filters.

**FTS5** (`src/vault/fts-index.ts`): shared `fts_memories` table for atoms and wiki pages, BM25 weights
`(4.0, 3.0, 1.0)` for title/tags/body, snippet length 64 tokens, rebuilt from scratch on `buildIndex()`.

**Hybrid search**: RRF with `k = 10` combining FTS5 BM25 + sqlite-vec KNN. Candidate window is
`max(limit * 10, 50)`. Each candidate is looked up in `memoryIndex` first, then `wikiIndex`; results
carry `resultKind: 'atom' | 'wiki'`.

## MCP tools (`src/tools/`)

The authoritative list is `getToolDefinitions()` / `handlers` in `src/tools/index.ts` — 31 tools.

**Memory (atoms):**
| Tool | Description |
|---|---|
| `memory_store` | Create atom; auto-links by Jaccard tag similarity; appends to daily note; schedules cluster rebuild |
| `memory_recall` | Fetch by id or title |
| `memory_search` | Hybrid search over atoms AND wiki pages; with no query, acts as filtered listing |
| `memory_update` | Patch frontmatter + content (this is also how you archive: `status: archived`) |
| `memory_append` | Append a dated section to an existing atom by ID |
| `memory_delete` | Delete and remove from index |
| `memory_link` | Add/remove bidirectional wiki-links |
| `memory_timeline` | Chronological activity view |
| `memory_stats` | Vault health: counts by lifecycle, stale/orphan counts, top tags; optional `vector` / `working` sections |
| `memory_cleanup` | Find/clean stale, archived or orphaned atoms; `dry_run: true` by default |

**Wiki (long-form synthesis):**
| Tool | Description |
|---|---|
| `wiki_write` | Create or update a Wiki page (mode: create\|update); updates search index |
| `wiki_read` | Read a Wiki page by relpath (e.g. `HowTos/oauth-setup.md`) |
| `wiki_list` | List Wiki pages by subfolder |
| `wiki_search` | Title-only match (filename + frontmatter title); does **not** search page bodies |
| `wiki_delete` | Delete a Wiki page; removes from search index |
| `wiki_move` | Move/rename a Wiki page; updates search index |

**Input / Output:**
| Tool | Description |
|---|---|
| `input_ingest` | Write a new immutable source file; rejects if path exists |
| `input_read` | Read a source file |
| `input_list` | List Input/ by subfolder |
| `input_supersede` | Mark an Input file as superseded (never deletes) |
| `output_write` | Create a deliverable; Zod-validated frontmatter |
| `output_read` | Read a deliverable |
| `output_update` | Update an existing deliverable |
| `output_delete` | Delete a deliverable |
| `output_list` | List Output/ by subfolder |

**Log (observability):** `log_read` (read a log file by date), `log_list` (list available dates).

**Working memory (per-session SQLite):**
| Tool | Description |
|---|---|
| `task_start` | Create task; seeds from `Memory/_index.md` clusters + search |
| `task_update` | Append findings, steps, artifacts, questions |
| `task_complete` | Promote findings to `Memory/`; clear task |
| `task_get` | Read current task state |

**Not exposed over MCP:** `memory_project` (`src/tools/project.ts`) is exported from `src/core/index.ts`
and reachable as `obsidian-mem project`, but it is deliberately absent from the MCP tool registry. Add it
to `src/tools/index.ts` if it should be callable by an MCP host.

## CLI (`obsidian-mem`)

`store · recall · search · update · delete · link · project · stats · cleanup · timeline`
(no `task`, `wiki`, `input`, `output` or `log` subcommands yet). Flags are kebab-case and map to the
handler's snake_case args (`--lifecycle-status` → `lifecycle_status`); comma-separated values become
arrays. Result JSON goes to stdout; exit code is 1 on a handler error. `obsidian-mem --help` prints the
command table.

## Working memory architecture (`src/working/`)

- `db.ts` — per-session `_index/wm-<PID>.sqlite`, DROP+CREATE on init for test isolation, orphan detection for dead PIDs, JSON snapshot on shutdown
- `retrieval.ts` — `task_start`: cluster-first seeding from `Memory/_index.md`, then search
- `promotion.ts` — `task_complete`: promotes findings to `Memory/`; procedural findings route to `wiki_write` + a stub atom

## Key conventions

- All file I/O goes through `src/vault/filesystem.ts` (plus `input/`, `output/`, `wiki/` filesystem modules); tools never touch `fs` directly
- All writes use `writeAtomicFile` (tmp+rename) and `withFileLock` for concurrency safety
- `src/vault/links.ts` manages bidirectional `[[wiki-link]]` auto-linking (atoms only, never wiki pages); slug renames are journalled (`src/vault/rename-journal.ts`) so a crash mid-rename is recoverable
- `src/vault/cluster-index.ts` generates the `Memory/_index.md` cluster map (atoms only)
- Zod schemas in `src/schemas/` are the single source of truth for frontmatter and tool inputs
- ESM: **all internal imports must use `.js` extensions**
- Tests are vitest, in `tests/`, against a temp vault (`tests/helpers/vault.ts`)
- Conventional Commits — release-please derives versions and the changelog from them
