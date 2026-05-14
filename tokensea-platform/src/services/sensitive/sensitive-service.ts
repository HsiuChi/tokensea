import type { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { notFound, badRequest } from "../../lib/errors.js";

const CACHE_KEY = "tokensea:sensitive_words";
const CACHE_TTL = 300; // 5 minutes

export class SensitiveWordService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  /** Check text against sensitive words — returns matched words and action */
  async checkContent(text: string): Promise<{ blocked: boolean; matches: string[]; action: string }> {
    const words = await this.loadWords();
    const matches: string[] = [];
    let worstAction = "none";

    const lower = text.toLowerCase();
    for (const w of words) {
      if (lower.includes(w.word.toLowerCase())) {
        matches.push(w.word);
        if (w.action === "block") worstAction = "block";
        else if (w.action === "replace" && worstAction !== "block") worstAction = "replace";
      }
    }

    return { blocked: worstAction === "block", matches, action: worstAction };
  }

  /** Replace sensitive words in text */
  async filterContent(text: string): Promise<string> {
    const words = await this.loadWords();
    let result = text;
    for (const w of words) {
      if (w.action === "replace") {
        const re = new RegExp(w.word, "gi");
        result = result.replace(re, "*".repeat(w.word.length));
      }
    }
    return result;
  }

  /** Load words from Redis cache or DB */
  private async loadWords(): Promise<{ word: string; action: string }[]> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch {}
    }

    const words = await this.prisma.sensitiveWord.findMany({
      where: { enabled: true },
      select: { word: true, action: true },
    });

    await this.redis.set(CACHE_KEY, JSON.stringify(words), "EX", CACHE_TTL);
    return words;
  }

  /** Invalidate cache after changes */
  private async invalidateCache() {
    await this.redis.del(CACHE_KEY);
  }

  // CRUD operations

  async list(opts?: { category?: string; enabled?: boolean }) {
    return this.prisma.sensitiveWord.findMany({
      where: {
        ...(opts?.category && { category: opts.category }),
        ...(opts?.enabled !== undefined && { enabled: opts.enabled }),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: { word: string; category?: string; action?: string; createdBy?: bigint }) {
    const existing = await this.prisma.sensitiveWord.findUnique({ where: { word: data.word } });
    if (existing) throw badRequest("Word already exists");

    const result = await this.prisma.sensitiveWord.create({
      data: {
        word: data.word,
        category: data.category ?? "general",
        action: data.action ?? "block",
        createdBy: data.createdBy ?? null,
      },
    });
    await this.invalidateCache();
    return result;
  }

  async batchCreate(words: string[], category = "general", action = "block", createdBy?: bigint) {
    const results = [];
    for (const word of words) {
      const existing = await this.prisma.sensitiveWord.findUnique({ where: { word } });
      if (!existing) {
        results.push(await this.prisma.sensitiveWord.create({
          data: { word, category, action, createdBy: createdBy ?? null },
        }));
      }
    }
    await this.invalidateCache();
    return { created: results.length };
  }

  async update(id: bigint, data: { word?: string; category?: string; action?: string; enabled?: boolean }) {
    const item = await this.prisma.sensitiveWord.findUnique({ where: { id } });
    if (!item) throw notFound("Sensitive word not found");

    const result = await this.prisma.sensitiveWord.update({ where: { id }, data });
    await this.invalidateCache();
    return result;
  }

  async delete(id: bigint) {
    const item = await this.prisma.sensitiveWord.findUnique({ where: { id } });
    if (!item) throw notFound("Sensitive word not found");

    await this.prisma.sensitiveWord.delete({ where: { id } });
    await this.invalidateCache();
    return { message: "Deleted" };
  }
}
