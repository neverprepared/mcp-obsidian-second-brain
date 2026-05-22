# Changelog

## [0.16.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.15.0...v0.16.0) (2026-05-22)


### Features

* wiki search indexing, perf metrics, MCP_SB_LOG_LEVEL ([#31](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/31)) ([c280c74](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/c280c741fe90aa891c391fd1bbdb2dc40b5388c0))

## [0.15.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.14.0...v0.15.0) (2026-05-22)


### Features

* index Wiki pages in search alongside Memory atoms ([#29](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/29)) ([d4d7896](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/d4d7896385e398ed946c32e77aa67ba0ffcb9e77))

## [0.14.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.13.0...v0.14.0) (2026-05-22)


### Features

* three-layer architecture (Input/Memory/Wiki/Output) replaces PARA ([#27](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/27)) ([d5dee87](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/d5dee87f61208cc25fc099827a8baa92160dac8b))


### Bug Fixes

* **tests:** init working db after vault path is set to tmpDir ([0386ae6](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/0386ae62e73074b78afb5110ae7281f6c470f7e8))
* **tests:** set tmpDir vault path before initWorkingDb in db.test.ts ([14e91d0](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/14e91d05f49acb17e3c93ee6f43a7ff4090b3d2f))

## [0.13.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.12.0...v0.13.0) (2026-05-17)


### Features

* add _attachments/ subfolder to Library for binary assets ([#25](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/25)) ([7501262](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/7501262f8224e6c7a8e246a6eacb6fa654f81a11))

## [0.12.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.11.2...v0.12.0) (2026-05-15)


### Features

* add Scratch/ subfolder to Library for in-progress documents ([#23](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/23)) ([2ccf8b2](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/2ccf8b2527b2830153d3744e51be1c194dda041c))

## [0.11.2](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.11.1...v0.11.2) (2026-05-15)


### Bug Fixes

* journal slug renames so partial batches recover on next startup ([#21](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/21)) ([5cb737b](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/5cb737be2a159c784bfd766940812e24f0e6cf1e))

## [0.11.1](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.11.0...v0.11.1) (2026-05-15)


### Bug Fixes

* keep FTS and vector index in sync across all mutation paths ([#19](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/19)) ([ccb0433](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/ccb04333af42ef73a5d84eeef6c95aa1589dde49))

## [0.11.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.10.0...v0.11.0) (2026-05-15)


### Features

* add Library/ vault folder for human-readable docs ([#15](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/15)) ([55b5518](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/55b55185f8338a709784eb4ca1cbcf06a56ae1f5))


### Performance Improvements

* drop in-memory body cache from index ([#17](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/17)) ([4130efc](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/4130efc267f764789c53249bcc515380f8edf0bd))

## [0.10.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.9.1...v0.10.0) (2026-05-05)


### Features

* extract core/ module and add obsidian-mem CLI ([#13](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/13)) ([920b087](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/920b0870c4bb15231ce06662d0436d27a9bcc481))

## [0.9.1](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.9.0...v0.9.1) (2026-05-02)


### Bug Fixes

* repair cross-references on slug rename, use index for link discovery, exact FTS matching ([#11](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/11)) ([6a6324d](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/6a6324d04d2b61badea0bf18ac3d6522ebfa389e))

## [0.9.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.8.0...v0.9.0) (2026-05-02)


### Features

* use sqlite-vec KNN search and consolidate tools from 18 to 14 ([#9](https://github.com/neverprepared/mcp-obsidian-second-brain/issues/9)) ([cc18993](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/cc189937f8e55bd229f623a5e73af8b2b97cd252))

## [0.8.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.7.1...v0.8.0) (2026-04-25)


### Features

* add working memory snapshot files and memory_working_stats tool ([00f4afd](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/00f4afdb0548aa0a4d4cd1800f9504d1888b1592))


### Bug Fixes

* initialize vector/FTS index before building memory index ([9702115](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/970211551e48c1f1be6f2255f923c5bb0336b90c))

## [0.7.1](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.7.0...v0.7.1) (2026-04-25)


### Bug Fixes

* correct pragma reads and FTS row count in vector_stats ([3b41404](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/3b414044169ab9aa73b24e43a6937eab494b2d2a))

## [0.7.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.6.0...v0.7.0) (2026-04-25)


### Features

* add memory_vector_stats tool for index observability ([c0ec6f6](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/c0ec6f6f6083a6090cdc8fb1d8d94b615f523ac9))


### Bug Fixes

* correct pragma reads and FTS row count in vector_stats ([3b41404](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/3b414044169ab9aa73b24e43a6937eab494b2d2a))
* SQLite concurrency safety for multi-instance access ([dcda687](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/dcda6871fe1f40f82e08ccf3f3ce89156de9e9fe))

## [0.6.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.5.0...v0.6.0) (2026-04-24)


### Features

* add exclude_tags filter, graph traversal, and promotion dedup ([9b89104](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/9b891040c0ded9882c8c63de85fa85226d9789fe))

## [0.5.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.4.1...v0.5.0) (2026-04-24)


### Features

* add exclude_tags filter, graph traversal, and promotion dedup ([9b89104](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/9b891040c0ded9882c8c63de85fa85226d9789fe))
* add FTS5 full-text search, memory_timeline tool, and fix tag re-embedding ([a42dc96](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/a42dc96468a2e6003f373a44ef9614476c918136))

## [0.4.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.3.1...v0.4.0) (2026-04-18)


### Features

* semantic vector search via Ollama + sqlite-vec ([21a37ef](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/21a37ef51b1a271ee7ea244b473e8475b98b55ab))


### Bug Fixes

* security hardening, input validation, and performance improvements ([079e2c0](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/079e2c0688c7eebd1c52bae5414212193124d5a9))

## [0.3.1](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.3.0...v0.3.1) (2026-04-17)


### Bug Fixes

* search per-keyword in retrieval to avoid phrase-match misses ([9467444](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/94674442894b8db512765fa6deb1640c6ef96c0f))

## [0.3.0](https://github.com/neverprepared/mcp-obsidian-second-brain/compare/v0.2.0...v0.3.0) (2026-04-17)


### Features

* add working memory layer with in-memory SQLite and Obsidian promotion ([bc80413](https://github.com/neverprepared/mcp-obsidian-second-brain/commit/bc804137f85e995f8996f699af008bf0642adc6e))
