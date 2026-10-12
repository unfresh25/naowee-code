import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

interface AdfMark {
  readonly type?: unknown;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

interface AdfNode {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly marks?: unknown;
}

const isNode = (value: unknown): value is AdfNode => typeof value === "object" && value !== null;

const childrenOf = (node: AdfNode): ReadonlyArray<AdfNode> =>
  Array.isArray(node.content) ? node.content.filter(isNode) : [];

const attr = (node: AdfNode, key: string): unknown => node.attrs?.[key];

const stringAttr = (node: AdfNode, key: string): string | null => {
  const value = attr(node, key);
  return typeof value === "string" && value.length > 0 ? value : null;
};

function applyMarks(text: string, marks: unknown): string {
  if (!Array.isArray(marks) || text.length === 0) return text;
  let result = text;
  let href: string | null = null;
  for (const mark of marks as ReadonlyArray<AdfMark>) {
    switch (mark.type) {
      case "code":
        result = `\`${result}\``;
        break;
      case "strong":
        result = `**${result}**`;
        break;
      case "em":
        result = `*${result}*`;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
      case "link": {
        const value = mark.attrs?.["href"];
        if (typeof value === "string" && value.length > 0) href = value;
        break;
      }
    }
  }
  return href === null ? result : `[${result}](${href})`;
}

function inlineToMarkdown(nodes: ReadonlyArray<AdfNode>): string {
  let result = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        result += applyMarks(typeof node.text === "string" ? node.text : "", node.marks);
        break;
      case "hardBreak":
        result += "  \n";
        break;
      case "mention": {
        const text = stringAttr(node, "text") ?? "";
        result += `@${text.replace(/^@/u, "")}`;
        break;
      }
      case "emoji":
        result += stringAttr(node, "text") ?? stringAttr(node, "shortName") ?? "";
        break;
      case "inlineCard": {
        const url = stringAttr(node, "url");
        if (url !== null) result += `<${url}>`;
        break;
      }
      case "date": {
        const date = DateTime.make(Number(stringAttr(node, "timestamp")));
        if (Option.isSome(date)) result += DateTime.formatIsoDateUtc(date.value);
        break;
      }
      case "status": {
        const text = stringAttr(node, "text");
        if (text !== null) result += `\`${text}\``;
        break;
      }
      default:
        result += inlineToMarkdown(childrenOf(node));
    }
  }
  return result;
}

const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map((line, index) => (index === 0 || line.length === 0 ? line : `${prefix}${line}`))
    .join("\n");

function listItemToMarkdown(item: AdfNode, marker: string): string {
  const parts = childrenOf(item).map((child) =>
    child.type === "paragraph" ? inlineToMarkdown(childrenOf(child)) : blockToMarkdown(child),
  );
  return `${marker}${indent(parts.filter((part) => part.length > 0).join("\n"), " ".repeat(marker.length))}`;
}

function tableToMarkdown(table: AdfNode): string {
  const rows = childrenOf(table).map((row) =>
    childrenOf(row).map((cell) =>
      childrenOf(cell)
        .map((child) =>
          child.type === "paragraph" ? inlineToMarkdown(childrenOf(child)) : blockToMarkdown(child),
        )
        .join(" ")
        .replace(/\s*\n\s*/gu, " ")
        .replaceAll("|", "\\|")
        .trim(),
    ),
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return "";
  const line = (cells: ReadonlyArray<string>) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [line(header), line(Array.from({ length: width }, () => "---")), ...body.map(line)].join(
    "\n",
  );
}

function blocksToMarkdown(nodes: ReadonlyArray<AdfNode>): string {
  return nodes
    .map(blockToMarkdown)
    .filter((block) => block.trim().length > 0)
    .join("\n\n");
}

function blockToMarkdown(node: AdfNode): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(childrenOf(node));
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(attr(node, "level")) || 1));
      return `${"#".repeat(level)} ${inlineToMarkdown(childrenOf(node))}`;
    }
    case "bulletList":
      return childrenOf(node)
        .map((item) => listItemToMarkdown(item, "- "))
        .join("\n");
    case "orderedList": {
      const start = Number(attr(node, "order")) || 1;
      return childrenOf(node)
        .map((item, index) => listItemToMarkdown(item, `${start + index}. `))
        .join("\n");
    }
    case "taskList":
      return childrenOf(node)
        .map((item) =>
          item.type === "taskItem"
            ? `- [${attr(item, "state") === "DONE" ? "x" : " "}] ${inlineToMarkdown(childrenOf(item))}`
            : blockToMarkdown(item),
        )
        .join("\n");
    case "codeBlock": {
      const language = stringAttr(node, "language") ?? "";
      const code = childrenOf(node)
        .map((child) => (typeof child.text === "string" ? child.text : ""))
        .join("");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "blockquote":
    case "panel":
      return blocksToMarkdown(childrenOf(node))
        .split("\n")
        .map((line) => (line.length === 0 ? ">" : `> ${line}`))
        .join("\n");
    case "rule":
      return "---";
    case "table":
      return tableToMarkdown(node);
    case "expand":
    case "nestedExpand": {
      const title = stringAttr(node, "title");
      const body = blocksToMarkdown(childrenOf(node));
      return title === null ? body : `**${title}**\n\n${body}`;
    }
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return "_[attachment]_";
    case "blockCard":
    case "embedCard": {
      const url = stringAttr(node, "url");
      return url === null ? "" : `<${url}>`;
    }
    default: {
      const children = childrenOf(node);
      if (children.length === 0) return inlineToMarkdown([node]);
      return children.every((child) => child.type === "text")
        ? inlineToMarkdown(children)
        : blocksToMarkdown(children);
    }
  }
}

export function adfToMarkdown(document: unknown): string {
  if (typeof document === "string") return document;
  if (!isNode(document)) return "";
  return blocksToMarkdown(document.type === "doc" ? childrenOf(document) : [document]).trim();
}

type AdfOutMark =
  | { readonly type: "strong" | "em" | "code" | "strike" }
  | { readonly type: "link"; readonly attrs: { readonly href: string } };

type AdfOutInline =
  | { readonly type: "text"; readonly text: string; readonly marks?: ReadonlyArray<AdfOutMark> }
  | { readonly type: "hardBreak" };

type AdfOutBlock = { readonly type: string; readonly [key: string]: unknown };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/gu;

function markdownInline(text: string, marks: ReadonlyArray<AdfOutMark> = []): AdfOutInline[] {
  const nodes: AdfOutInline[] = [];
  const pushText = (value: string, extra: ReadonlyArray<AdfOutMark>) => {
    if (value.length === 0) return;
    nodes.push(
      extra.length === 0
        ? { type: "text", text: value }
        : { type: "text", text: value, marks: extra },
    );
  };
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    pushText(text.slice(cursor, index), marks);
    const [token, code, strong, strike, em, link, url] = match;
    if (code !== undefined) {
      pushText(code.slice(1, -1), [...marks, { type: "code" }]);
    } else if (strong !== undefined) {
      nodes.push(...markdownInline(strong.slice(2, -2), [...marks, { type: "strong" }]));
    } else if (strike !== undefined) {
      nodes.push(...markdownInline(strike.slice(2, -2), [...marks, { type: "strike" }]));
    } else if (em !== undefined) {
      nodes.push(...markdownInline(em.slice(1, -1), [...marks, { type: "em" }]));
    } else if (link !== undefined) {
      const split = link.indexOf("](");
      pushText(link.slice(1, split), [
        ...marks,
        { type: "link", attrs: { href: link.slice(split + 2, -1) } },
      ]);
    } else if (url !== undefined) {
      pushText(url, [...marks, { type: "link", attrs: { href: url } }]);
    } else {
      pushText(token, marks);
    }
    cursor = index + token.length;
  }
  pushText(text.slice(cursor), marks);
  return nodes;
}

function paragraph(lines: ReadonlyArray<string>): AdfOutBlock {
  const content: AdfOutInline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    content.push(...markdownInline(line.replace(/\s+$/u, "")));
  });
  return { type: "paragraph", content };
}

const BULLET = /^\s*[-*+]\s+(.*)$/u;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/u;
const HEADING = /^(#{1,6})\s+(.*)$/u;
const QUOTE = /^>\s?(.*)$/u;
const FENCE = /^```\s*([\w+-]*)\s*$/u;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/u;

function markdownBlocks(lines: ReadonlyArray<string>): AdfOutBlock[] {
  const blocks: AdfOutBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index]!)) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push({
        type: "codeBlock",
        ...(fence[1] ? { attrs: { language: fence[1] } } : {}),
        content: code.length === 0 ? [] : [{ type: "text", text: code.join("\n") }],
      });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        attrs: { level: heading[1]!.length },
        content: markdownInline(heading[2]!.trim()),
      });
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) {
        quoted.push(QUOTE.exec(lines[index]!)![1]!);
        index += 1;
      }
      blocks.push({ type: "blockquote", content: markdownBlocks(quoted) });
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (BULLET.test(line) || ordered) {
      const pattern = ordered ? ORDERED : BULLET;
      const items: AdfOutBlock[] = [];
      while (index < lines.length && pattern.test(lines[index]!)) {
        const match = pattern.exec(lines[index]!)!;
        const text = ordered ? match[2]! : match[1]!;
        items.push({ type: "listItem", content: [paragraph([text])] });
        index += 1;
      }
      blocks.push(
        ordered
          ? {
              type: "orderedList",
              attrs: { order: Number(ordered[1]) || 1 },
              content: items,
            }
          : { type: "bulletList", content: items },
      );
      continue;
    }
    const text: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim().length > 0 &&
      !FENCE.test(lines[index]!) &&
      !HEADING.test(lines[index]!) &&
      !QUOTE.test(lines[index]!) &&
      !BULLET.test(lines[index]!) &&
      !ORDERED.test(lines[index]!)
    ) {
      text.push(lines[index]!);
      index += 1;
    }
    blocks.push(paragraph(text));
  }
  return blocks;
}

export function markdownToAdf(markdown: string) {
  return {
    type: "doc",
    version: 1,
    content: markdownBlocks(markdown.replace(/\r\n?/gu, "\n").split("\n")),
  };
}
