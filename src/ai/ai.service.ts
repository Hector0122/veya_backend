import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export type AiProvider = 'groq' | 'gemini';

export interface AiResult {
  text: string;
  provider: AiProvider;
}

// Respuestas con razonamiento (gpt-oss, Gemini con thinking) gastan tokens
// antes de escribir el JSON; con el límite de 1024 que usaba Vellum se
// quedaban cortas.
const MAX_OUTPUT_TOKENS = 4096;
const TEMPERATURE = 0.4;

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Cliente de IA compartido (portado de `vellum_backend/src/lib/ai.ts`):
 * Groq como proveedor principal y Gemini como respaldo automático. Igual que
 * TmdbService/AnilistService, nunca lanza: si no hay keys o los dos fallan
 * devuelve null y el llamador usa su propio fallback.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly groq: AxiosInstance | null;
  private readonly gemini: AxiosInstance | null;
  private readonly groqModel: string;
  private readonly geminiModel: string;

  constructor(private readonly configService: ConfigService) {
    const groqKey = this.configService.get<string>('ai.groqApiKey');
    const geminiKey = this.configService.get<string>('ai.geminiApiKey');
    this.groqModel = this.configService.get<string>('ai.groqModel')!;
    this.geminiModel = this.configService.get<string>('ai.geminiModel')!;

    this.groq = groqKey
      ? axios.create({
          baseURL: 'https://api.groq.com/openai/v1',
          headers: { Authorization: `Bearer ${groqKey}` },
          timeout: 30000,
        })
      : null;
    // Key en header y no en la query string, para que no aparezca en logs.
    this.gemini = geminiKey
      ? axios.create({
          baseURL: 'https://generativelanguage.googleapis.com/v1beta',
          headers: { 'x-goog-api-key': geminiKey },
          timeout: 30000,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.groq !== null || this.gemini !== null;
  }

  /** Pide una respuesta en JSON. Devuelve el texto crudo (el llamador lo
   *  valida) y qué proveedor respondió, o null si ninguno pudo. */
  async generateJson(prompt: string): Promise<AiResult | null> {
    if (this.groq) {
      const text = await this.callGroq(prompt);
      if (text) return { text, provider: 'groq' };
    }
    if (this.gemini) {
      const text = await this.callGemini(prompt);
      if (text) return { text, provider: 'gemini' };
    }
    return null;
  }

  private async callGroq(prompt: string): Promise<string | null> {
    try {
      const { data } = await this.groq!.post<GroqResponse>(
        '/chat/completions',
        {
          model: this.groqModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: TEMPERATURE,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          response_format: { type: 'json_object' },
        },
      );
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (error) {
      this.logger.warn(`Groq falló: ${(error as Error).message}`);
      return null;
    }
  }

  private async callGemini(prompt: string): Promise<string | null> {
    try {
      const { data } = await this.gemini!.post<GeminiResponse>(
        `/models/${this.geminiModel}:generateContent`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: TEMPERATURE,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
          },
        },
      );
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      return (
        parts
          .map((part) => part.text ?? '')
          .join('')
          .trim() || null
      );
    } catch (error) {
      this.logger.warn(`Gemini falló: ${(error as Error).message}`);
      return null;
    }
  }
}
