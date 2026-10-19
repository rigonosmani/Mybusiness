import Anthropic from "@anthropic-ai/sdk";
import { config, CATEGORIES } from "./config.js";
import { sourceName } from "./sources.js";

const LANG_NAME = { sq: "Albanian", en: "English" };

const SUBMIT_TOOL = {
  name: "submit_article",
  description: "Submit the finished original article for editor review. Call this exactly once, when the article is complete.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "body_markdown", "category", "sources", "single_source", "editor_notes"],
    properties: {
      title: { type: "string", description: "Original headline, max ~90 characters. Not a copy of any source headline." },
      summary: { type: "string", description: "One or two sentence standfirst." },
      body_markdown: { type: "string", description: "Article body in Markdown (paragraphs, optional ## subheadings). 300-700 words." },
      category: { type: "string", enum: CATEGORIES },
      sources: {
        type: "array",
        description: "Every outlet or document the facts came from, including the original tip.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "url"],
          properties: { name: { type: "string" }, url: { type: "string" } },
        },
      },
      single_source: { type: "boolean", description: "True if no independent confirmation beyond the original tip was found." },
      editor_notes: { type: "string", description: "Short notes for the human editor: what to verify, gaps, anything uncertain." },
    },
  },
};

function systemPrompt() {
  return `You are a reporter for ${config.siteName}, an independent Kosovo/Albanian news site. You write ORIGINAL news articles in ${LANG_NAME[config.lang]}.

You receive a tip: a headline and link from another outlet. Treat it only as a lead that something happened. Your job:
1. Use web search to find independent coverage and primary sources (official statements, institutions, wire services, other outlets) about the same event.
2. Write a new article in your own structure and words, built from the facts you verified across sources. Add useful context and background a reader needs.
3. Never reproduce sentences, paragraph structure or distinctive phrasing from any source. Short direct quotes from people involved are fine when clearly attributed.
4. Attribute claims in the text ("according to the Ministry...", "as first reported by VoxKosova..."). Credit the outlet that broke the story.
5. Do not invent facts, numbers, quotes or names. If something cannot be confirmed, say so in the text or leave it out, and flag it in editor_notes.
6. Neutral, factual tone. No clickbait.

When finished, call submit_article. A human editor reviews every draft before publishing.`;
}

function leadPrompt(lead) {
  const lines = [
    `Source outlet: ${sourceName(lead.source)}`,
    `Headline: ${lead.title}`,
    `Link: ${lead.url}`,
  ];
  if (lead.excerpt) lines.push(`Feed teaser: ${lead.excerpt}`);
  if (lead.note) lines.push(`Editor's note: ${lead.note}`);
  return `New tip:\n${lines.join("\n")}\n\nResearch it and write the article.`;
}

export class DraftError extends Error {}

// Runs the research + writing loop for one lead and returns the submit_article input.
export async function draftFromLead(lead, client = new Anthropic()) {
  const messages = [{ role: "user", content: leadPrompt(lead) }];

  for (let turn = 0; turn < 6; turn++) {
    const res = await client.beta.messages.create({
      model: config.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: systemPrompt(),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: config.maxWebSearches }, SUBMIT_TOOL],
      messages,
    });

    if (res.stop_reason === "refusal") {
      throw new DraftError(`Model declined: ${res.stop_details?.explanation || res.stop_details?.category || "no reason given"}`);
    }

    const call = res.content.find((b) => b.type === "tool_use" && b.name === "submit_article");
    if (call) return validateDraft(call.input);

    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "max_tokens") throw new DraftError("Draft was cut off (max_tokens).");
    if (res.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "Please call submit_article with the finished article now." });
    }
  }
  throw new DraftError("Model did not submit an article.");
}

function validateDraft(d) {
  if (!d || typeof d.title !== "string" || !d.title.trim() || typeof d.body_markdown !== "string" || !d.body_markdown.trim()) {
    throw new DraftError("Draft was missing a title or body.");
  }
  return {
    title: d.title.trim(),
    summary: String(d.summary || "").trim(),
    bodyMd: d.body_markdown.trim(),
    category: CATEGORIES.includes(d.category) ? d.category : "news",
    sources: Array.isArray(d.sources) ? d.sources.filter((s) => s?.url && s?.name) : [],
    singleSource: !!d.single_source,
    editorNotes: String(d.editor_notes || "").trim(),
  };
}
