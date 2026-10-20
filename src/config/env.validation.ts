import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  TMDB_API_KEY: Joi.string().allow('').optional(),
  TMDB_BASE_URL: Joi.string().default('https://api.themoviedb.org/3'),
  ANILIST_BASE_URL: Joi.string().default('https://graphql.anilist.co'),
  OPEN_LIBRARY_BASE_URL: Joi.string().default('https://openlibrary.org'),
  // IA de recomendaciones de libros: opcional, sin keys se usa el motor de
  // géneros.
  GROQ_API_KEY: Joi.string().allow('').optional(),
  GROQ_MODEL: Joi.string().default('openai/gpt-oss-120b'),
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  GEMINI_MODEL: Joi.string().default('gemini-flash-latest'),
});
