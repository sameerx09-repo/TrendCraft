CREATE TABLE IF NOT EXISTS auth_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 password_hash text NOT NULL, brand_profile_id uuid NOT NULL UNIQUE REFERENCES brand_profiles(id),
 role text NOT NULL DEFAULT 'brand' CHECK(role IN ('owner','brand')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_bootstrap (
 id text PRIMARY KEY, token_hash text NOT NULL, email text NOT NULL,
 brand_profile_id uuid NOT NULL REFERENCES brand_profiles(id), expires_at timestamptz NOT NULL, claimed_at timestamptz
);
CREATE TABLE IF NOT EXISTS auth_attempts (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
-- Sources belong to a workspace; refreshing another brand must not replace them.
CREATE UNIQUE INDEX IF NOT EXISTS products_brand_source_unique ON products(brand_profile_id,source_url);
CREATE UNIQUE INDEX IF NOT EXISTS trend_items_brand_source_unique ON trend_items(brand_profile_id,source_url);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_source_url_unique;
ALTER TABLE trend_items DROP CONSTRAINT IF EXISTS trend_items_source_url_unique;