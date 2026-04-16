# mcp-obsidian-second-brain

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives Claude a persistent, structured memory system backed by an Obsidian vault. Memories are stored as Markdown files with YAML frontmatter using the [PARA method](https://fortelabs.com/blog/para/) (Projects, Areas, Resources, Archives).

## Installation

### Option 1: npx from GitHub (no clone required)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "obsidian-second-brain": {
      "command": "npx",
      "args": ["-y", "github:neverprepared/mcp-obsidian-second-brain"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/your/obsidian/vault"
      }
    }
  }
}
```

### Option 2: Clone and run locally

```bash
git clone https://github.com/neverprepared/mcp-obsidian-second-brain.git
cd mcp-obsidian-second-brain
npm install
npm run build
```

Then add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "obsidian-second-brain": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-obsidian-second-brain/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/your/obsidian/vault"
      }
    }
  }
}
```

### Option 3: Claude Code (CLI)

Add to `~/.claude/claude_desktop_config.json` or run:

```bash
claude mcp add obsidian-second-brain \
  -e OBSIDIAN_VAULT_PATH=/path/to/your/obsidian/vault \
  -- npx -y github:neverprepared/mcp-obsidian-second-brain
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `OBSIDIAN_VAULT_PATH` | `~/workspaces/profiles/personal/obsidian/vaults/memory` | Path to your Obsidian vault directory |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` (logs go to stderr) |
| `MIN_SHARED_TAGS` | `2` | Minimum shared tags required for auto-linking memories |

The vault directory will be created automatically on first run with the PARA folder structure.

## Tools

| Tool | Description |
|---|---|
| `memory_store` | Create a new memory in a PARA category with optional tags and source URLs |
| `memory_recall` | Fetch a specific memory by ID or title |
| `memory_search` | Full-text search with relevance scoring, tag filters (`and`/`or`), date filters, and freshness |
| `memory_list` | Paginated listing with filters by PARA, tags, status, and date range |
| `memory_update` | Update content, tags, PARA category (moves file), or title (renames file) |
| `memory_archive` | Set a memory's status to archived |
| `memory_delete` | Permanently delete a memory (cascades to clean up backlinks) |
| `memory_link` | Create bidirectional `[[wiki-links]]` between two memories, or discover existing links |
| `memory_project` | Create projects with deadlines, mark complete, or list active projects |
| `memory_stats` | Vault health summary: counts by PARA/status, stale memories, orphans, top tags |
| `memory_cleanup` | Bulk list/archive/delete stale, archived, or orphaned memories (safe `dry_run` by default) |

## Vault Structure

```
<OBSIDIAN_VAULT_PATH>/
├── Projects/     # Time-bound goals (stale after 30 days)
├── Areas/        # Ongoing responsibilities (stale after 90 days)
├── Resources/    # Reference material (stale after 180 days)
├── Archives/     # Inactive memories (stale after 365 days)
└── _daily/       # Daily notes (auto-appended on each store)
```

Each memory is a Markdown file with YAML frontmatter. Files are named by slugified title and support bidirectional `[[wiki-links]]`.

## Development

```bash
npm run dev          # Run with tsx (no build required)
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Type-check without emitting
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

Copy `.env.example` to `.env` and set `OBSIDIAN_VAULT_PATH` before running locally.
