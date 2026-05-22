# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Run with tsx (no build required)
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Type-check without emitting
npm test             # Run all tests once
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

Run a single test file:
```bash
npx vitest run tests/vault/naming.test.ts
```

## Environment

Copy `.env.example` and set:
- `OBSIDIAN_VAULT_PATH` — path to the Obsidian vault directory (default: `~/workspaces/profiles/personal/obsidian/vaults/memory`)
- `MCP_SB_LOG_LEVEL` — `debug | info | warn | error` (default: `info`). All logs go to **stderr** so they don't interfere with MCP stdio transport. `LOG_LEVEL` is accepted as a fallback for backwards compatibility.

## Architecture

This is a **Model Context Protocol (MCP) server** that exposes an Obsidian vault as a structured second-brain memory system. It runs as a stdio process; the MCP host (e.g. Claude Desktop) communicates via stdin/stdout.

### Startup sequence (`src/server.ts`)
1. `ensureVaultStructure()` — creates layer folders + system folders if missing
2. `buildIndex()` — scans `Memory/` atoms and `Wiki/` pages into in-memory indexes; rebuilds FTS5
3. `initWorkingDb()` — opens or creates per-session `wm-<PID>.sqlite` for working memory
4. Registers MCP tool handlers and connects stdio transport

### Four-layer vault structure

```
<VAULT_PATH>/
├── Input/          ← raw sources, immutable after ingest
├── Memory/         ← atoms: short, factual, machine-indexed (FTS5 + vector)
├── Wiki/           ← long-form synthesis, machine-indexed, Claude writes and retrieves
│   ├── HowTos/
│   ├── Runbooks/
│   ├── References/
│   └── Scratch/
├── Output/         ← deliverables for external consumption
├── _daily/         ← atom creation log (daily rotation)
├── _index/         ← vectors.db, wm-<PID>.sqlite
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

### Retrieval protocol

Always start with `memory_search`. Results are ranked by hybrid score (RRF of FTS5 BM25 + vector KNN).

- **Atom result** — has `ID:` field. Use `memory_recall` for full content.
- **Wiki result** — prefixed `[Wiki]`, has `Path:` field. Use `wiki_read` with the path for full content.

```
1. memory_search(query)
      ├─ atom result  → memory_recall(id) if full content needed
      └─ [Wiki] result → wiki_read("HowTos/oauth-setup.md")
```

Wiki pages surface alongside atoms in the same search — no separate wiki search step needed. Wiki pages are never stale and are excluded from `freshness: stale` queries.

### Memory atom format
Each atom is a markdown file in `Memory/<slug>.md` with YAML frontmatter:

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

### Search indexes (`src/vault/search.ts`)
Two parallel in-memory indexes, both backed by the shared `fts_memories` FTS5 table and `vec_embeddings` vector store in `_index/vectors.db`:

- **`memoryIndex`** — `Map<id, IndexEntry>` for atoms. Key is the atom `id` (e.g. `mem_123_slug`).
- **`wikiIndex`** — `Map<"wiki:<relPath>", WikiIndexEntry>` for Wiki pages. Key is prefixed with `wiki:` to namespace it from atom ids.

`buildIndex()` walks both `Memory/` and `Wiki/` subfolders and populates both maps + FTS. `wiki_write`/`wiki_delete`/`wiki_move` call `indexWikiEntry`/`removeWikiFromIndex` to keep the wiki index in sync on every mutation.

Wiki pages are excluded from: auto-linking (Jaccard), cluster map (`Memory/_index.md`), `freshness: stale` filter, `lifecycle_status` filter, `status` filter.

### FTS5 full-text index (`src/vault/fts-index.ts`)
Shared `fts_memories` table for both atoms and wiki pages. BM25 weights `(4.0, 3.0, 1.0)` for title/tags/body. Snippet length 64 tokens. Rebuilt from scratch on `buildIndex()`.

### Hybrid search (`src/vault/search.ts`)
RRF (k=10) combining FTS5 BM25 + sqlite-vec KNN. Candidate window = `max(limit * 10, 50)`. Each candidate looked up in `memoryIndex` first, then `wikiIndex`. Results carry `resultKind: 'atom' | 'wiki'`.

### MCP tools (`src/tools/`)

**Memory (atoms):**
| Tool | Description |
|---|---|
| `memory_store` | Create atom; auto-links by Jaccard tag similarity; appends to daily note; schedules cluster rebuild |
| `memory_recall` | Fetch by id, title, or slug |
| `memory_search` | Hybrid search — returns atoms AND wiki pages ranked together |
| `memory_list` | Paginated listing with filters |
| `memory_update` | Patch frontmatter + content |
| `memory_append` | Append a dated section to an existing atom by ID |
| `memory_archive` | Set status=archived |
| `memory_delete` | Delete and remove from index |
| `memory_link` | Add/remove bidirectional wiki-links |
| `memory_timeline` | Chronological activity view |

**Wiki (long-form synthesis):**
| Tool | Description |
|---|---|
| `wiki_write` | Create or update a Wiki page (mode: create\|update); updates search index |
| `wiki_read` | Read a Wiki page by relpath (e.g. `HowTos/oauth-setup.md`) |
| `wiki_list` | List Wiki pages by subfolder |
| `wiki_search` | Title-only grep across Wiki/ |
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

**Log (observability):**
| Tool | Description |
|---|---|
| `log_read` | Read a specific log file by date |
| `log_list` | List available log dates |

**Working memory (per-session SQLite):**
| Tool | Description |
|---|---|
| `task_start` | Create task; seeds from Memory/_index.md clusters + search |
| `task_update` | Append findings, steps, artifacts, questions |
| `task_complete` | Promote findings to Memory/; clear task |
| `task_get` | Read current task state |

### Working memory architecture (`src/working/`)
- `db.ts` — per-session `wm-<PID>.sqlite`, DROP+CREATE on init for test isolation, orphan detection
- `retrieval.ts` — `task_start`: cluster-first seeding from `Memory/_index.md`, then search
- `promotion.ts` — `task_complete`: promotes findings to `Memory/`; procedural findings route to `wiki_write` + stub atom

### Key conventions
- All file I/O is in `src/vault/filesystem.ts`; tools never touch `fs` directly
- All writes use `writeAtomicFile` (tmp+rename) and `withFileLock` for concurrency safety
- `src/vault/links.ts` manages bidirectional `[[wiki-link]]` auto-linking (atoms only, never wiki pages)
- `src/vault/cluster-index.ts` generates `Memory/_index.md` cluster map (atoms only)
- TypeScript is ESM (`"type": "module"`); all internal imports must use `.js` extensions
