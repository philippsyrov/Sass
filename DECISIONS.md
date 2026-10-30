# Product decisions

- Discord personality and relationship rules apply equally to every speaker. Administrative permissions remain separate.
- Chat generation and memory embeddings use independent configuration. Choosing a chat provider does not silently choose a cloud embedding service.
- The normal local installer includes a private runtime, PostgreSQL and the pinned text memory model. Expert source/server configurations remain documented separately.
- Persistent data is scoped to each Discord server. Deletion reports success only after its database transaction succeeds.
- Release bundles pin runtime and model inputs, include dependency notices, and are checked before publication. Automated checks do not establish native platform acceptance.
