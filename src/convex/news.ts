"use node";

// The "anti-lose" layer. Before the bot commits to a YES/NO side, it pulls the
// freshest headlines about the match and lets an LLM (via the VLY gateway)
// confirm which outcome the news actually supports. No news → no trade. If
// the LLM is unreachable, a deterministic keyword heuristic takes over.

import { createVlyIntegrations } from "@vly-ai/integrations";
import { fetchHeadlines, Headline, teamsFromQuestion } from "./polymarket";

const vly = createVlyIntegrations({
  deploymentToken: process.env.VLY_INTEGRATION_KEY ?? "",
  debug: process.env.NODE_ENV === "development",
});

export type NewsVerdict = "YES" | "NO" | "UNCLEAR";

export interface NewsCheck {
  ts: number;
  verdict: NewsVerdict;
  summary: string;
  headlines: string[];
}

const POSITIVE_WORDS =
  /\b(win|wins|beat|beats|defeat|defeats|dominat|advance|advances|qualif|favorite|strong|roster boost|sign|signs|joins|top seed|takes down|sweeps?|3-0|2-0)\b/;
const NEGATIVE_WORDS =
  /\b(lose|loses|defeat(ed)?|eliminat|out of|bench(ed)?|injur|drop(ped)?|weak|struggl|upset|banned|suspended|withdraw|forfeit)\b/;

// ---------------------------------------------------------------------------
// Verdict computation
// ---------------------------------------------------------------------------

function parseLlmVerdict(text: string): NewsVerdict | null {
  const cleaned = text.replace(/```(json)?/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { verdict?: unknown };
    const verdict = String(parsed.verdict ?? "").toUpperCase();
    if (verdict === "YES" || verdict === "NO" || verdict === "UNCLEAR") {
      return verdict;
    }
  } catch {
    // fall through to null
  }
  return null;
}

function summarizeHeadlines(headlines: Headline[]): string {
  if (headlines.length === 0) {
    return "No recent headlines found for this match.";
  }
  return headlines.slice(0, 3).map((h) => h.title).join(" | ");
}

async function llmVerdict(
  question: string,
  outcomes: string[],
  headlines: Headline[],
): Promise<NewsVerdict | null> {
  try {
    const lines = headlines
      .map((h) => `- ${h.title}${h.date ? ` (${h.date})` : ""}`)
      .join("\n");
    // Never let the LLM stall the 5s scan loop: if the gateway is slow, fall
    // back to the keyword heuristic after 12s.
    const completion = vly.ai.completion({
      model: "gpt-5",
      temperature: 0,
      maxTokens: 160,
      messages: [
        {
          role: "system",
          content:
            "You are a research analyst for a prediction-market trading bot that only trades esports match-winner markets. " +
            "You are given a market and recent news headlines about the match. " +
            "Decide which outcome the NEWS supports right now, not what the market odds say. " +
            'Reply with ONLY a JSON object like {"verdict":"YES"|"NO"|"UNCLEAR","summary":"one short sentence"}. ' +
            'YES means the news favors outcome A (the first outcome). NO means it favors outcome B (the second). ' +
            "UNCLEAR if headlines are missing, about a different match, contradictory, or don't clearly favor one side. " +
            "Prefer UNCLEAR over guessing — this bot must never trade on a hunch.",
        },
        {
          role: "user",
          content:
            `Market question: ${question}\n` +
            `Outcome A (YES): ${outcomes[0] ?? "?"}\n` +
            `Outcome B (NO): ${outcomes[1] ?? "?"}\n\n` +
            `Recent headlines:\n${lines || "(none)"}`,
        },
      ],
    });
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 12_000),
    );
    const result = await Promise.race([completion, timeout]);
    if (!result || !result.success || !result.data) return null;
    const content = result.data.choices?.[0]?.message?.content ?? "";
    return parseLlmVerdict(content);
  } catch {
    return null;
  }
}

// Deterministic fallback: count headlines that favor each team.
function heuristicVerdict(
  outcomes: string[],
  headlines: Headline[],
): NewsVerdict {
  const a = (outcomes[0] ?? "").trim().toLowerCase();
  const b = (outcomes[1] ?? "").trim().toLowerCase();
  // Generic "Yes"/"No" outcomes can't be keyword-scored reliably.
  if (!a || !b || a.length < 3 || b.length < 3 || /\b(yes|no|true|false)\b/.test(a) || /\b(yes|no|true|false)\b/.test(b)) {
    return "UNCLEAR";
  }
  if (headlines.length === 0) return "UNCLEAR";

  let score = 0; // positive → favors A
  for (const h of headlines) {
    const text = h.title.toLowerCase();
    const mentionsA = text.includes(a);
    const mentionsB = text.includes(b);

    // Direct "A beats B" style verdicts are the strongest signal.
    for (const verb of [" beats ", " beat ", " defeats ", " defeat ", " dominates ", " takes down ", " sweeps ", " wins over ", " advances past "]) {
      if (mentionsA && text.includes(`${verb}${b}`)) score += 2;
      if (mentionsB && text.includes(`${verb}${a}`)) score -= 2;
    }

    const posA = mentionsA && POSITIVE_WORDS.test(text);
    const negA = mentionsA && NEGATIVE_WORDS.test(text);
    const posB = mentionsB && POSITIVE_WORDS.test(text);
    const negB = mentionsB && NEGATIVE_WORDS.test(text);

    if (posA && !negA) score += 1;
    if (negA && !posA) score -= 1;
    if (posB && !negB) score -= 1;
    if (negB && !posB) score += 1;
  }

  if (score >= 2) return "YES";
  if (score <= -2) return "NO";
  return "UNCLEAR";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// Fetch headlines for the match and produce a verdict. Never throws: returns
// null only if headline fetching itself blows up, which callers treat as
// "no news → no trade".
export async function validateMarketNews(
  question: string,
  outcomes: string[],
): Promise<NewsCheck | null> {
  let headlines: Headline[];
  try {
    headlines = await fetchHeadlines(question);
  } catch {
    return null;
  }

  const llm = await llmVerdict(question, outcomes, headlines);
  const verdict = llm ?? heuristicVerdict(outcomes, headlines);

  const { teams } = teamsFromQuestion(question);
  const summary =
    verdict === "UNCLEAR"
      ? summarizeHeadlines(headlines)
      : `News favors ${verdict === "YES" ? (outcomes[0] ?? "A") : (outcomes[1] ?? "B")} (${teams.join(" vs ")}) — ${llm ? "LLM check" : "keyword check"}`;

  return {
    ts: Date.now(),
    verdict,
    summary,
    headlines: headlines.map((h) => h.title),
  };
}
