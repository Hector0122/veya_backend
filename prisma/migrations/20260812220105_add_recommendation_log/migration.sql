-- CreateTable
CREATE TABLE "recommendation_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "recommended_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_recommendation_log_user_recommended" ON "recommendation_log"("user_id", "recommended_at");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_log_user_id_content_id_key" ON "recommendation_log"("user_id", "content_id");

-- AddForeignKey
ALTER TABLE "recommendation_log" ADD CONSTRAINT "recommendation_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_log" ADD CONSTRAINT "recommendation_log_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
