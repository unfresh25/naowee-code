import { describe, expect, it } from "vite-plus/test";

import { adfToMarkdown, markdownToAdf } from "./jiraAdf.ts";

const text = (value: string, marks?: ReadonlyArray<Record<string, unknown>>) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

describe("adfToMarkdown", () => {
  it("renders the blocks and marks Jira descriptions use", () => {
    const document = {
      type: "doc",
      version: 1,
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Contexto")] },
        {
          type: "paragraph",
          content: [
            text("Revisar "),
            text("staging", [{ type: "strong" }]),
            text(" y "),
            text("docs", [{ type: "link", attrs: { href: "https://example.com" } }]),
            { type: "hardBreak" },
            { type: "mention", attrs: { text: "@Jorge Borja" } },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [text("uno")] },
                {
                  type: "orderedList",
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [text("a")] }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { state: "DONE" }, content: [text("hecho")] },
            { type: "taskItem", attrs: { state: "TODO" }, content: [text("pendiente")] },
          ],
        },
        { type: "codeBlock", attrs: { language: "sql" }, content: [text("select 1;")] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [text("Env")] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [text("Ok")] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [text("stg")] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [text("a|b")] }] },
              ],
            },
          ],
        },
        { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] },
      ],
    };

    expect(adfToMarkdown(document)).toBe(
      [
        "## Contexto",
        "Revisar **staging** y [docs](https://example.com)  \n@Jorge Borja",
        "- uno\n  1. a",
        "- [x] hecho\n- [ ] pendiente",
        "```sql\nselect 1;\n```",
        "| Env | Ok |\n| --- | --- |\n| stg | a\\|b |",
        "_[attachment]_",
      ].join("\n\n"),
    );
  });

  it("returns empty text for a missing description", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
  });
});

describe("markdownToAdf", () => {
  it("turns a comment written in the app into Jira's document format", () => {
    expect(
      markdownToAdf("Listo en **stg**, ver `run.sh` y https://ci.example.com/1.\n\n- uno\n- dos"),
    ).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            text("Listo en "),
            text("stg", [{ type: "strong" }]),
            text(", ver "),
            text("run.sh", [{ type: "code" }]),
            text(" y "),
            text("https://ci.example.com/1", [
              { type: "link", attrs: { href: "https://ci.example.com/1" } },
            ]),
            text("."),
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("uno")] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [text("dos")] }] },
          ],
        },
      ],
    });
  });

  it("keeps code fences verbatim and survives a round trip", () => {
    const markdown = "## Pasos\n\n```bash\nvp run dev\n```\n\n1. Abrir\n2. Probar";
    expect(adfToMarkdown(markdownToAdf(markdown))).toBe(markdown);
  });
});
