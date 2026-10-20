import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';

jest.mock('axios');

const groqPost = jest.fn();
const geminiPost = jest.fn();

function makeService(keys: { groq?: string; gemini?: string }) {
  (axios.create as jest.Mock).mockImplementation(
    (config: { baseURL: string }) => ({
      post: config.baseURL.includes('groq') ? groqPost : geminiPost,
    }),
  );
  const config = new ConfigService({
    ai: {
      groqApiKey: keys.groq,
      geminiApiKey: keys.gemini,
      groqModel: 'groq-model',
      geminiModel: 'gemini-model',
    },
  });
  return new AiService(config);
}

const groqOk = (content: string) => ({
  data: { choices: [{ message: { content } }] },
});
const geminiOk = (text: string) => ({
  data: { candidates: [{ content: { parts: [{ text }] } }] },
});

describe('AiService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses Groq first', async () => {
    groqPost.mockResolvedValue(groqOk('{"a":1}'));
    const ai = makeService({ groq: 'g', gemini: 'm' });

    await expect(ai.generateJson('prompt')).resolves.toEqual({
      text: '{"a":1}',
      provider: 'groq',
    });
    expect(geminiPost).not.toHaveBeenCalled();
    expect(groqPost).toHaveBeenCalledWith(
      '/chat/completions',
      expect.objectContaining({ model: 'groq-model' }),
    );
  });

  it('falls back to Gemini when Groq fails', async () => {
    groqPost.mockRejectedValue(new Error('503'));
    geminiPost.mockResolvedValue(geminiOk('{"b":2}'));
    const ai = makeService({ groq: 'g', gemini: 'm' });

    await expect(ai.generateJson('prompt')).resolves.toEqual({
      text: '{"b":2}',
      provider: 'gemini',
    });
    expect(geminiPost).toHaveBeenCalledWith(
      '/models/gemini-model:generateContent',
      expect.anything(),
    );
  });

  it('falls back to Gemini when Groq answers empty', async () => {
    groqPost.mockResolvedValue(groqOk('   '));
    geminiPost.mockResolvedValue(geminiOk('{"b":2}'));
    const ai = makeService({ groq: 'g', gemini: 'm' });

    await expect(ai.generateJson('prompt')).resolves.toMatchObject({
      provider: 'gemini',
    });
  });

  it('returns null when both providers fail', async () => {
    groqPost.mockRejectedValue(new Error('down'));
    geminiPost.mockRejectedValue(new Error('down'));
    const ai = makeService({ groq: 'g', gemini: 'm' });

    await expect(ai.generateJson('prompt')).resolves.toBeNull();
  });

  it('uses only Gemini when there is no Groq key', async () => {
    geminiPost.mockResolvedValue(geminiOk('{"c":3}'));
    const ai = makeService({ gemini: 'm' });

    await expect(ai.generateJson('prompt')).resolves.toMatchObject({
      provider: 'gemini',
    });
    expect(groqPost).not.toHaveBeenCalled();
  });

  it('is not configured and makes no requests without keys', async () => {
    const ai = makeService({});

    expect(ai.isConfigured()).toBe(false);
    await expect(ai.generateJson('prompt')).resolves.toBeNull();
    expect(groqPost).not.toHaveBeenCalled();
    expect(geminiPost).not.toHaveBeenCalled();
  });
});
