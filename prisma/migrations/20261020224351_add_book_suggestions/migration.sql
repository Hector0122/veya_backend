-- CreateTable
CREATE TABLE "book_suggestions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "synopsis" TEXT,
    "reason" TEXT,
    "based_on" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "book_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_book_suggestions_user_status" ON "book_suggestions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "book_suggestions_user_id_content_id_key" ON "book_suggestions"("user_id", "content_id");

-- AddForeignKey
ALTER TABLE "book_suggestions" ADD CONSTRAINT "book_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_suggestions" ADD CONSTRAINT "book_suggestions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
