const ATTRIBUTION = /^On .+ wrote:\s*$/;
const OUTLOOK_MARKER = /^-{2,}\s*Original Message\s*-{2,}$/i;
const RULE = /^_{10,}$/;

/** The rule Outlook (and Inboxed) draws above a reply's history in plain text, over its From: line. */
export const TRAIL_RULE = "_".repeat(32);

/** Removes one level of `>` markers. The reader draws the quote rule itself, so the outer markers are noise. */
export function unquote(quoted: string): string {
  return quoted.replace(/^> ?/gm, "");
}

/** Splits a plain-text body into what the sender wrote and the quoted reply chain below it. */
export function splitQuoted(body: string): { text: string; quoted: string } {
  const lines = body.split("\n");
  const start = lines.findIndex(
    (line, i) =>
      ATTRIBUTION.test(line) ||
      OUTLOOK_MARKER.test(line.trim()) ||
      (RULE.test(line.trim()) && /^From:/.test(lines[i + 1] ?? "")) ||
      (line.startsWith(">") && lines.slice(i).every((l) => l.startsWith(">") || l.trim() === "")),
  );
  if (start === -1) return { text: body, quoted: "" };
  return { text: lines.slice(0, start).join("\n").trimEnd(), quoted: lines.slice(start).join("\n") };
}
