import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/ë/g, "e")
      .replace(/ç/g, "c")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "artikull"
  );
}

export function uniqueSlug(title, exists) {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; exists(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function stripHtml(html = "") {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

export function renderMarkdown(md) {
  return sanitizeHtml(marked.parse(md), {
    allowedTags: ["p", "h2", "h3", "h4", "strong", "em", "a", "ul", "ol", "li", "blockquote", "br", "hr"],
    allowedAttributes: { a: ["href", "rel", "target"] },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener nofollow", target: "_blank" }),
    },
  });
}

export function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Parses "Name | https://url" lines (the admin sources textarea) into objects.
export function parseSourcesText(text = "") {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, url] = line.split("|").map((s) => s.trim());
      return url && isHttpUrl(url) ? { name: name || url, url } : null;
    })
    .filter(Boolean);
}

export const escapeXml = (s = "") =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
