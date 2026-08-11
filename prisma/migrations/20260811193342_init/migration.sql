-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refresh_token_hash" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "original_title" TEXT,
    "poster_url" TEXT,
    "backdrop_url" TEXT,
    "overview" TEXT,
    "genres" TEXT[],
    "release_date" DATE,
    "metadata" JSONB,
    "cached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_contents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "rating" SMALLINT,
    "current_season" INTEGER,
    "current_episode" INTEGER,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "notes" TEXT,

    CONSTRAINT "user_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "contents_source_external_id_key" ON "contents"("source", "external_id");

-- CreateIndex
CREATE INDEX "idx_user_contents_user" ON "user_contents"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_contents_status" ON "user_contents"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_user_contents_updated" ON "user_contents"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_contents_user_id_content_id_key" ON "user_contents"("user_id", "content_id");

-- AddForeignKey
ALTER TABLE "user_contents" ADD CONSTRAINT "user_contents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contents" ADD CONSTRAINT "user_contents_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
