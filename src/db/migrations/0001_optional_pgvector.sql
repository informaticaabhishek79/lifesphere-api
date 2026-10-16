-- Optional vector search for the knowledge base.
-- Runs everywhere, but only creates the embeddings table where the pgvector extension is available
-- (e.g. Neon). Without it the API falls back to Postgres full-text search automatically.
-- Embedding dimension is fixed at 1536 (EMBEDDINGS_DIMENSIONS must match).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS knowledge_chunk_embeddings (
      chunk_id uuid PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
      model varchar(80) NOT NULL,
      embedding vector(1536) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS kce_hnsw_idx ON knowledge_chunk_embeddings USING hnsw (embedding vector_cosine_ops);
  ELSE
    RAISE NOTICE 'pgvector not available: knowledge search will use full-text search only';
  END IF;
END
$$;
