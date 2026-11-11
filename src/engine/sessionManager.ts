import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionMessage } from '../index.js';
import type { FileSnapshot, TokenStats } from '../commands/types.js';

export interface SessionData {
  sessionId: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  workspaceDir: string;
  mode: 'build' | 'plan';
  history: SessionMessage[];
  addedFiles: string[];
  tokenStats: TokenStats;
  snapshots: FileSnapshot[];
}

export interface SessionSummary {
  sessionId: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  workspaceDir: string;
  mode: 'build' | 'plan';
  turnCount: number;
  totalTokens: number;
  filePath: string;
}

const SESSIONS_DIR_NAME = 'sessions';

export function getSessionsDir(): string {
  const homeSessions = path.join(os.homedir(), '.machcode', SESSIONS_DIR_NAME);
  if (!fsSync.existsSync(homeSessions)) {
    fsSync.mkdirSync(homeSessions, { recursive: true });
  }
  return homeSessions;
}

export function getSessionFilePath(sessionId: string): string {
  const cleanId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getSessionsDir(), `${cleanId}.json`);
}

/**
 * Saves or updates a session to disk (~/.machcode/sessions/<sessionId>.json).
 */
export async function saveSession(data: SessionData): Promise<string> {
  const filePath = getSessionFilePath(data.sessionId);
  const now = new Date().toISOString();

  const payload: SessionData = {
    ...data,
    updatedAt: now,
    createdAt: data.createdAt || now,
  };

  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });

  return filePath;
}

/**
 * Loads a session from disk by sessionId or 'latest'.
 */
export async function loadSession(
  sessionIdOrLatest?: string,
  workspaceDir?: string,
): Promise<SessionData | null> {
  const sessions = await listSessions(workspaceDir);
  if (sessions.length === 0) {
    return null;
  }

  let targetId = sessionIdOrLatest;
  if (!targetId || targetId === 'latest') {
    targetId = sessions[0].sessionId;
  }

  const exactPath = getSessionFilePath(targetId);
  try {
    if (fsSync.existsSync(exactPath)) {
      const raw = await fs.readFile(exactPath, 'utf-8');
      return JSON.parse(raw) as SessionData;
    }
  } catch {
    // try finding by prefix
  }

  const match = sessions.find(
    (s) =>
      s.sessionId.toLowerCase().startsWith(targetId!.toLowerCase()) ||
      (s.name && s.name.toLowerCase().includes(targetId!.toLowerCase())),
  );

  if (match && fsSync.existsSync(match.filePath)) {
    const raw = await fs.readFile(match.filePath, 'utf-8');
    return JSON.parse(raw) as SessionData;
  }

  return null;
}

/**
 * Lists all stored sessions, sorted from newest to oldest.
 */
export async function listSessions(workspaceDir?: string): Promise<SessionSummary[]> {
  const dir = getSessionsDir();
  const summaries: SessionSummary[] = [];

  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fullPath = path.join(dir, f);
      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        const data = JSON.parse(raw) as SessionData;

        if (workspaceDir) {
          const normA = path.resolve(data.workspaceDir).toLowerCase();
          const normB = path.resolve(workspaceDir).toLowerCase();
          if (normA !== normB) continue;
        }

        const totalTokens =
          (data.tokenStats?.estimatedPromptTokens ?? 0) +
          (data.tokenStats?.estimatedCompletionTokens ?? 0);

        summaries.push({
          sessionId: data.sessionId,
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          workspaceDir: data.workspaceDir,
          mode: data.mode ?? 'build',
          turnCount: data.history ? Math.floor(data.history.length / 2) : 0,
          totalTokens,
          filePath: fullPath,
        });
      } catch {
        // ignore corrupted json files
      }
    }
  } catch {
    // dir unreadable
  }

  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}

/**
 * Deletes a session file by ID.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const filePath = getSessionFilePath(sessionId);
  try {
    if (fsSync.existsSync(filePath)) {
      await fs.unlink(filePath);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
