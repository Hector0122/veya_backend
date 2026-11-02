-- AlterTable
ALTER TABLE "user_contents" ADD COLUMN "current_page" INTEGER,
ADD COLUMN "total_pages" INTEGER;

-- Los libros guardados "para leer después" pasan a la lista como "quiero leer"
-- (estado pendiente), salvo que el usuario ya tenga ese libro registrado.
INSERT INTO "user_contents" ("id", "user_id", "content_id", "status", "added_at", "updated_at")
SELECT gen_random_uuid(), s."user_id", s."content_id", 'pendiente', s."created_at", CURRENT_TIMESTAMP
FROM "book_suggestions" s
WHERE s."status" = 'saved'
ON CONFLICT ("user_id", "content_id") DO NOTHING;
