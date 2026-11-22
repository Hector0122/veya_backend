-- En TMDB las películas y las series tienen ids que se repiten. Con la
-- unicidad solo por (source, external_id), cachear la serie 1399 pisaba la
-- película 1399 (y viceversa) y al abrirla se mostraba otra cosa.
DROP INDEX "contents_source_external_id_key";

CREATE UNIQUE INDEX "contents_source_type_external_id_key" ON "contents"("source", "type", "external_id");
