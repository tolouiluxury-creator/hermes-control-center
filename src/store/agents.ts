import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';

/**
 * Named agent presets: a saved bundle of model, toolset, skills and a system
 * prompt that a user can keep and apply. Hermes 0.19 has no such concept (it has
 * profiles), so this is the control center's own data, in our database.
 */

export interface Agent {
  id: string;
  name: string;
  description: string;
  provider: string | null;
  model: string | null;
  toolset: string | null;
  skills: string[];
  systemPrompt: string;
  /** Optional accent colour for the card, so presets are easy to tell apart. */
  accent: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentInput {
  name: string;
  description?: string;
  provider?: string | null;
  model?: string | null;
  toolset?: string | null;
  skills?: string[];
  systemPrompt?: string;
  accent?: string | null;
}

interface AgentRow {
  id: string;
  name: string;
  description: string;
  provider: string | null;
  model: string | null;
  toolset: string | null;
  skills: string;
  system_prompt: string;
  accent: string | null;
  created_at: number;
  updated_at: number;
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

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider,
    model: row.model,
    toolset: row.toolset,
    skills: parseList(row.skills),
    systemPrompt: row.system_prompt,
    accent: row.accent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Trimmed, de-duplicated skill names, order preserved. */
function normalizeSkills(skills: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const skill of skills ?? []) {
    const clean = skill.trim();
    if (clean === '' || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Raised when a preset name is already in use; the route turns it into a 409. */
export class AgentNameTakenError extends Error {
  constructor(readonly agentName: string) {
    super(`An agent named "${agentName}" already exists.`);
    this.name = 'AgentNameTakenError';
  }
}

export class AgentsRepo {
  constructor(private readonly store: Store) {}

  list(): Agent[] {
    return this.store.all<AgentRow>('SELECT * FROM agents ORDER BY updated_at DESC').map(toAgent);
  }

  get(id: string): Agent | null {
    const row = this.store.get<AgentRow>('SELECT * FROM agents WHERE id = ?', id);
    return row ? toAgent(row) : null;
  }

  private nameOwner(name: string): string | null {
    const row = this.store.get<{ id: string }>('SELECT id FROM agents WHERE name = ?', name);
    return row?.id ?? null;
  }

  create(input: AgentInput, now = Date.now()): Agent {
    const name = input.name.trim();
    if (this.nameOwner(name) !== null) throw new AgentNameTakenError(name);

    const agent: Agent = {
      id: randomUUID(),
      name,
      description: input.description?.trim() ?? '',
      provider: clean(input.provider),
      model: clean(input.model),
      toolset: clean(input.toolset),
      skills: normalizeSkills(input.skills),
      systemPrompt: input.systemPrompt ?? '',
      accent: clean(input.accent),
      createdAt: now,
      updatedAt: now,
    };

    this.store.run(
      `INSERT INTO agents
         (id, name, description, provider, model, toolset, skills, system_prompt, accent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      agent.id,
      agent.name,
      agent.description,
      agent.provider,
      agent.model,
      agent.toolset,
      JSON.stringify(agent.skills),
      agent.systemPrompt,
      agent.accent,
      agent.createdAt,
      agent.updatedAt,
    );

    return agent;
  }

  update(id: string, input: AgentInput, now = Date.now()): Agent | null {
    const existing = this.get(id);
    if (!existing) return null;

    const name = input.name.trim();
    const owner = this.nameOwner(name);
    if (owner !== null && owner !== id) throw new AgentNameTakenError(name);

    const updated: Agent = {
      ...existing,
      name,
      description: input.description?.trim() ?? '',
      provider: clean(input.provider),
      model: clean(input.model),
      toolset: clean(input.toolset),
      skills: normalizeSkills(input.skills),
      systemPrompt: input.systemPrompt ?? '',
      accent: clean(input.accent),
      updatedAt: now,
    };

    this.store.run(
      `UPDATE agents SET name = ?, description = ?, provider = ?, model = ?, toolset = ?,
         skills = ?, system_prompt = ?, accent = ?, updated_at = ? WHERE id = ?`,
      updated.name,
      updated.description,
      updated.provider,
      updated.model,
      updated.toolset,
      JSON.stringify(updated.skills),
      updated.systemPrompt,
      updated.accent,
      updated.updatedAt,
      id,
    );

    return updated;
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.store.run('DELETE FROM agents WHERE id = ?', id);
    return true;
  }
}
