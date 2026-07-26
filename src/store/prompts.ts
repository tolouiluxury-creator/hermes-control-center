import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';

/**
 * The prompt library. Hermes has no such thing, so this is the control center's
 * own data — which is why it lives in our database and not in the agent's.
 */

export interface Prompt {
  id: string;
  title: string;
  body: string;
  /** Placeholder names found in the body, e.g. {{thema}}. Derived, never stored by hand. */
  variables: string[];
  tags: string[];
  uses: number;
  createdAt: number;
  updatedAt: number;
}

export interface PromptInput {
  title: string;
  body: string;
  tags?: string[];
}

interface PromptRow {
  id: string;
  title: string;
  body: string;
  variables: string;
  tags: string;
  uses: number;
  created_at: number;
  updated_at: number;
}

/**
 * Reads `{{name}}` placeholders out of a prompt body.
 *
 * Derived rather than entered: a variable list that disagrees with the text is
 * worse than none, and keeping them in sync by hand is a chore nobody does.
 */
export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_ -]{0,60})\s*\}\}/g)) {
    const name = match[1]?.trim();
    if (name) found.add(name);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    variables: parseList(row.variables),
    tags: parseList(row.tags),
    uses: row.uses,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Trimmed, de-duplicated, order preserved. Empty tags are dropped, not stored. */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags ?? []) {
    const clean = tag.trim().toLowerCase();
    if (clean === '' || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

export class PromptsRepo {
  constructor(private readonly store: Store) {}

  list(): Prompt[] {
    return this.store
      .all<PromptRow>('SELECT * FROM prompts ORDER BY updated_at DESC')
      .map(toPrompt);
  }

  get(id: string): Prompt | null {
    const row = this.store.get<PromptRow>('SELECT * FROM prompts WHERE id = ?', id);
    return row ? toPrompt(row) : null;
  }

  create(input: PromptInput, now = Date.now()): Prompt {
    const prompt: Prompt = {
      id: randomUUID(),
      title: input.title.trim(),
      body: input.body,
      variables: extractVariables(input.body),
      tags: normalizeTags(input.tags),
      uses: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.store.run(
      `INSERT INTO prompts (id, title, body, variables, tags, uses, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      prompt.id,
      prompt.title,
      prompt.body,
      JSON.stringify(prompt.variables),
      JSON.stringify(prompt.tags),
      prompt.uses,
      prompt.createdAt,
      prompt.updatedAt,
    );

    return prompt;
  }

  update(id: string, input: PromptInput, now = Date.now()): Prompt | null {
    const existing = this.get(id);
    if (!existing) return null;

    const updated: Prompt = {
      ...existing,
      title: input.title.trim(),
      body: input.body,
      variables: extractVariables(input.body),
      tags: normalizeTags(input.tags),
      updatedAt: now,
    };

    this.store.run(
      `UPDATE prompts SET title = ?, body = ?, variables = ?, tags = ?, updated_at = ? WHERE id = ?`,
      updated.title,
      updated.body,
      JSON.stringify(updated.variables),
      JSON.stringify(updated.tags),
      updated.updatedAt,
      id,
    );

    return updated;
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.store.run('DELETE FROM prompts WHERE id = ?', id);
    return true;
  }

  /** Counts a copy-to-clipboard, so the library can be sorted by what is actually used. */
  recordUse(id: string): number | null {
    const existing = this.get(id);
    if (!existing) return null;

    const uses = existing.uses + 1;
    this.store.run('UPDATE prompts SET uses = ? WHERE id = ?', uses, id);
    return uses;
  }
}
