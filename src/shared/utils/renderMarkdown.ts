import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

/**
 * Markdown → sanitized HTML for read-only surfaces (release notes…).
 * Heavy (markdown-it + DOMPurify): load it with `import()` so it stays out of
 * the startup bundle. The markdown-pdf tool keeps its own copy on purpose
 * (one tool = one folder, AGENTS.md §3).
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true });

// every link leaves the extension page in a new tab
const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source), { ADD_ATTR: ["target", "rel"] });
}
