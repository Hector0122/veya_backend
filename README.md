# Veya — Backend

API en NestJS + TypeScript para [Veya](../VEYA.md): registro/login, búsqueda unificada en TMDB + AniList, y tracking de progreso/estados/favoritos/calificación del usuario.

## Stack

- NestJS 11 + TypeScript
- Prisma ORM 7 (driver adapter `@prisma/adapter-pg`) + PostgreSQL
- Passport + JWT (access/refresh)
- Axios (TMDB) + GraphQL sobre fetch (AniList)

## Arquitectura

```text
src/
├── auth/            # register, login, refresh (con rotación), logout
├── users/           # perfil del usuario autenticado
├── catalog/         # búsqueda unificada, detalle, trending; cachea en `contents`
├── tracking/         # CRUD de user_contents (estado, progreso, favoritos, rating)
├── recommendations/ # motor de recomendaciones sin IA (géneros/favoritos/rating)
├── tmdb/             # cliente TMDB
├── anilist/          # cliente AniList (GraphQL público)
├── common/           # filtro de excepciones, decorators, DTOs, constantes
├── config/           # configuración tipada + validación de env (Joi)
└── prisma/           # PrismaService (driver adapter pg)
```

## Setup local

1. **Postgres**: necesitás una DB accesible. Local con Homebrew:
   ```bash
   brew services start postgresql@16
   createdb veya
   ```
   o usá directamente la `DATABASE_URL` de un servicio Postgres en Railway.

2. **Variables de entorno**: copiá `.env.example` a `.env` y completá:
   - `DATABASE_URL` — cadena de conexión Postgres
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — strings largos y aleatorios (≥16 chars)
   - `TMDB_API_KEY` — [conseguila gratis en themoviedb.org](https://www.themoviedb.org/settings/api) (v3 auth). Sin esto, `/catalog/*` sigue funcionando pero solo devuelve resultados de AniList (TMDB falla en silencio y se loguea el warning).

3. **Instalar y migrar**:
   ```bash
   npm install
   npx prisma migrate dev
   ```

4. **Correr**:
   ```bash
   npm run start:dev
   ```
   API en `http://localhost:3000`.

## Deploy (Railway)

- Agregá un servicio Postgres en Railway y copiá su `DATABASE_URL` (interna) a las variables de entorno del servicio del backend.
- Variables requeridas en Railway: las mismas de `.env.example` (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TMDB_API_KEY`, etc).
- Build command: `npm run build` — Start command: `npm run start:prod`.
- Corré `npx prisma migrate deploy` (no `migrate dev`) contra la DB de producción — hacelo como *release command* de Railway o manualmente antes del primer deploy.

## Endpoints

```http
POST /auth/register        { email, password }
POST /auth/login           { email, password }
POST /auth/refresh         { refreshToken }        # rota el refresh token
POST /auth/logout          (Bearer access token)

GET  /users/me             (Bearer access token)

GET  /catalog/search?q=    búsqueda unificada TMDB + AniList (cachea en `contents`)
GET  /catalog/trending
GET  /catalog/recommendations   (Bearer) — géneros frecuentes / favoritos / rating alto
GET  /catalog/:id          detalle (id interno de `contents`)

GET    /tracking?status=&favorite=    (Bearer) — "Mi lista" / "Continuar viendo" (status=viendo)
POST   /tracking                      (Bearer) { contentId, status?, notes? }
PATCH  /tracking/:id                  (Bearer) { status?, isFavorite?, rating?, currentSeason?, currentEpisode?, notes? }
DELETE /tracking/:id                  (Bearer)
```

Todas las respuestas de error tienen la forma `{ statusCode, message, error, path, timestamp }`.

## Notas de implementación (más allá del doc original)

- **Refresh tokens**: se guarda un hash SHA-256 (no bcrypt — un JWT completo supera los 72 bytes que bcrypt trunca, lo que rompería la comparación) del refresh token vigente en `users.refresh_token_hash`, con rotación en cada `/auth/refresh` y comparación en tiempo constante.
- **Constraint única en `contents(source, external_id)`**: el doc pide un índice; se agregó como `@@unique` (mismo nombre) para poder cachear resultados de búsqueda con upsert sin duplicar filas.
- **Constraint única en `user_contents(user_id, content_id)`**: necesaria para que "guardar a mi lista" sea idempotente.
- **`GET /catalog/recommendations`** vive en `CatalogController` pero delega en `RecommendationsModule` (dependencia circular resuelta con `forwardRef`), tal como lo separa la arquitectura del doc.
