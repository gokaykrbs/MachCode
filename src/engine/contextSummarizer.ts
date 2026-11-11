import type { SessionMessage } from '../index.js';

export interface SummarizeOptions {
  /** Maximum token limit before triggering summarization. Defaults to 12,000 tokens. */
  maxContextTokens?: number;
  /** Number of oldest turns to condense into an executive summary. Defaults to 8. */
  turnsToSummarize?: number;
  /** Minimum number of recent turns to always keep untouched. Defaults to 4. */
  keepRecentTurns?: number;
  /** Optional custom summarization function (e.g. calling lightweight fast model). */
  summarizeFn?: (text: string) => Promise<string>;
}

export interface SummarizeResult {
  summarized: boolean;
  history: SessionMessage[];
  summarizedTurnsCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  savedTokens: number;
}

export const DEFAULT_MAX_CONTEXT_TOKENS = 12000;
export const DEFAULT_TURNS_TO_SUMMARIZE = 8;
export const DEFAULT_KEEP_RECENT_TURNS = 4;

/**
 * Approximates token count of a message string (1 token ~ 4 characters).
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimates total token footprint of a session message array.
 */
export function estimateHistoryTokens(messages: SessionMessage[]): number {
  return messages.reduce((acc, m) => acc + estimateTextTokens(m.content) + 4, 0);
}

/**
 * Formats oldest turns into a structured text transcript ready for summarization.
 */
export function formatTurnsForSummary(turns: SessionMessage[]): string {
  return turns
    .map((m, idx) => {
      const sender = m.role === 'user' ? 'User' : 'Assistant';
      const snippet = m.content.length > 500 ? `${m.content.slice(0, 500)}...` : m.content;
      return `[Step ${idx + 1}] ${sender}: ${snippet}`;
    })
    .join('\n');
}

/**
 * Generates an executive summary of condensed conversation turns.
 */
export function generateDeterministicSummary(turns: SessionMessage[]): string {
  const userPrompts: string[] = [];
  const assistantActions: string[] = [];

  for (const t of turns) {
    if (t.role === 'user') {
      const firstLine = t.content.split('\n')[0].replace(/^\[.*?\]:\s*/, '').trim();
      if (firstLine.length > 0) {
        userPrompts.push(firstLine.slice(0, 100));
      }
    } else {
      if (t.content.includes('Modified files:')) {
        const match = /Modified files:\s*([^\n]+)/.exec(t.content);
        if (match) assistantActions.push(`Modified ${match[1].trim()}`);
      } else if (t.content.length > 0) {
        const firstLine = t.content.split('\n')[0].trim();
        if (firstLine.length > 0 && assistantActions.length < 5) {
          assistantActions.push(firstLine.slice(0, 100));
        }
      }
    }
  }

  const promptRecap =
    userPrompts.length > 0 ? userPrompts.slice(0, 5).join('; ') : 'Initial architecture queries';
  const actionRecap =
    assistantActions.length > 0
      ? assistantActions.slice(0, 5).join('; ')
      : 'Completed analysis and code operations';

  return `[Context Summary of Earlier Turns (${turns.length} messages)]:\n• Prior Tasks: ${promptRecap}\n• Prior Outcomes: ${actionRecap}\n(Earlier context preserved compactly to prevent context overflow).`;
}

/**
 * Inspects conversation history and condenses the oldest turns if the token limit is exceeded.
 */
export async function summarizeOldestTurns(
  messages: SessionMessage[],
  options: SummarizeOptions = {},
): Promise<SummarizeResult> {
  const maxTokens = options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const turnsToSummarize = options.turnsToSummarize ?? DEFAULT_TURNS_TO_SUMMARIZE;
  const keepRecent = options.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS;

  const tokensBefore = estimateHistoryTokens(messages);

  // If below token limit or history is too short to safely condense, return unchanged
  if (tokensBefore <= maxTokens || messages.length <= keepRecent + 2) {
    return {
      summarized: false,
      history: messages,
      summarizedTurnsCount: 0,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: tokensBefore,
      savedTokens: 0,
    };
  }

  // Calculate slice boundaries: summarize up to (messages.length - keepRecent), capped by turnsToSummarize
  const countToSummarize = Math.min(turnsToSummarize, messages.length - keepRecent);
  if (countToSummarize < 2) {
    return {
      summarized: false,
      history: messages,
      summarizedTurnsCount: 0,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: tokensBefore,
      savedTokens: 0,
    };
  }

  const turnsToCondense = messages.slice(0, countToSummarize);
  const preservedRecentTurns = messages.slice(countToSummarize);

  let summaryContent = '';
  if (options.summarizeFn) {
    try {
      const transcript = formatTurnsForSummary(turnsToCondense);
      const prompt = `Summarize the following prior conversation steps into a concise 3-sentence technical summary:\n${transcript}`;
      summaryContent = await options.summarizeFn(prompt);
      summaryContent = `[Context Summary of Prior Turns]:\n${summaryContent}`;
    } catch {
      summaryContent = generateDeterministicSummary(turnsToCondense);
    }
  } else {
    summaryContent = generateDeterministicSummary(turnsToCondense);
  }

  const summaryMessage: SessionMessage = {
    role: 'assistant',
    content: summaryContent,
  };

  const newHistory: SessionMessage[] = [summaryMessage, ...preservedRecentTurns];
  const tokensAfter = estimateHistoryTokens(newHistory);

  return {
    summarized: true,
    history: newHistory,
    summarizedTurnsCount: countToSummarize,
    estimatedTokensBefore: tokensBefore,
    estimatedTokensAfter: tokensAfter,
    savedTokens: Math.max(0, tokensBefore - tokensAfter),
  };
}
