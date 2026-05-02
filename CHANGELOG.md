# Changelog

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
