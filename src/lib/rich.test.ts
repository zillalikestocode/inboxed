import { describe, expect, it } from "vitest";
import { baseCss, emailHtml, plainText, splitTrail, swapSignatureHtml, TRAIL_MARK, textToHtml, trailHtml } from "./rich";
import type { Message } from "./types";

describe("textToHtml", () => {
  it("makes a paragraph of every line, escaped", () => {
    expect(textToHtml("a\n\nb<&")).toBe("<p>a</p><p></p><p>b&lt;&amp;</p>");
    expect(textToHtml("")).toBe("<p></p>");
  });
});

const original: Message = {
  id: "acc/d1@x", threadId: "acc/d1@x", subject: "Dinner <plans>", draft: false, attachments: [], cc: [],
  from: { name: "Maya Chen", email: "maya@example.com" }, to: [{ name: "You", email: "you@example.com" }, { name: "", email: "bo@x" }],
  date: "2026-10-15T12:00:00.000Z", body: "Are you free?\n\nSaturday <works>.",
};
const base = { font: "Georgia, serif", size: 12, color: "#0b5394" };

describe("trailHtml", () => {
  it("is Outlook's: a marker, a rule over bold headers in the base font, then the message", () => {
    const t = trailHtml(original, base, "en-US");
    expect(t.startsWith(TRAIL_MARK)).toBe(true);
    expect(t).toContain(`<div id="divRplyFwdMsg" style="${baseCss(base)}; border-top: 1px solid #b5c4df; padding-top: 3pt; margin-top: 12pt">`);
    expect(t).toContain('<b>From:</b> Maya Chen &lt;<a href="mailto:maya@example.com">maya@example.com</a>&gt;<br>');
    expect(t).toContain('<b>To:</b> You &lt;<a href="mailto:you@example.com">you@example.com</a>&gt;; <a href="mailto:bo@x">bo@x</a><br>');
    expect(t).toContain("<b>Subject:</b> Dinner &lt;plans&gt;</div>");
    expect(t).not.toContain("Cc:");
    // Plain text keeps its lines, in the base font.
    expect(t).toContain(`<div style="${baseCss(base)}"><div>Are you free?</div><div><br></div><div>Saturday &lt;works&gt;.</div></div>`);
  });

  it("keeps the HTML body, drops the page around it (style sheets too), scripts, and pictures it can't carry", () => {
    const html =
      '<!doctype html><html><head><title>x</title><style>.a{color:red}</style></head><body class="b"><p class="a">Hi</p>' +
      `<script>alert(1)</script><img src="data:image/png;base64,${"A".repeat(200_000)}"><img src="cid:logo@x"><img src="data:image/png;base64,AAAA"></body></html>`;
    const t = trailHtml({ ...original, html }, base, "en-US");
    expect(t).toContain('<div><p class="a">Hi</p><img src="data:image/png;base64,AAAA"></div>');
    expect(t).not.toContain("<style");
    expect(t).not.toContain("<script");
    expect(t).not.toContain("<title");
    expect(t.length).toBeLessThan(2000);
  });
});

describe("splitTrail", () => {
  it("finds a saved draft's trail in both versions, or nothing", () => {
    const html = `<div style="x"><p>Hi</p></div>${TRAIL_MARK}<div>old</div>`;
    const body = `Hi\n\n${"_".repeat(32)}\nFrom: Maya`;
    expect(splitTrail(html, body)).toEqual({ html: `${TRAIL_MARK}<div>old</div>`, text: `\n\n${"_".repeat(32)}\nFrom: Maya` });
    // Stored without the blank line (the engine trims), when nothing was written above it.
    expect(splitTrail(html, body.slice(4))?.text).toBe(`\n\n${"_".repeat(32)}\nFrom: Maya`);
    expect(splitTrail("<p>Hi</p>", body)).toBeNull();
    expect(splitTrail(html, "Hi")).toBeNull();
  });
});

describe("emailHtml", () => {
  it("wraps in the base font and keeps paragraphs single-spaced, empty ones a line high", () => {
    const out = emailHtml('<p style="text-align: center">x</p><p></p><p>y</p>');
    expect(out).toMatch(/^<div style="font-family: [^"]+; font-size: 11pt">/);
    expect(emailHtml("<p>x</p>", base)).toBe(`<div style="${baseCss(base)}"><p style="margin: 0">x</p></div>`);
    expect(out).toContain('<p style="margin: 0; text-align: center">x</p><p style="margin: 0"><br></p><p style="margin: 0">y</p></div>');
  });
  it("leaves mentions alone and doesn't wrap twice", () => {
    const mention = '<p><a href="mailto:ada@x" data-type="mention" data-id="ada@x" data-label="Ada">@Ada</a></p>';
    expect(emailHtml(mention)).toContain('<a href="mailto:ada@x" data-type="mention" data-id="ada@x" data-label="Ada">@Ada</a>');
    expect(emailHtml(emailHtml("<p>x</p>"))).toBe(emailHtml("<p>x</p>"));
    expect(emailHtml(emailHtml("<p>x</p>", base))).toBe(emailHtml("<p>x</p>", base)); // a draft saved with another font
  });
  it("leaves a reply's trail as it is, after what was written", () => {
    const trail = `${TRAIL_MARK}<div id="divRplyFwdMsg">h</div><div><p>old</p></div>`;
    expect(emailHtml(`<p>x</p>${trail}`, base)).toBe(`<div style="${baseCss(base)}"><p style="margin: 0">x</p></div>${trail}`);
    expect(emailHtml(emailHtml(`<p>x</p>${trail}`))).toBe(emailHtml(`<p>x</p>${trail}`));
  });
});

describe("swapSignatureHtml", () => {
  it("swaps, removes, adds (above a folded quote), and leaves an edited one alone", () => {
    expect(swapSignatureHtml("<p>Hi</p><p></p><p>-- </p><p>Sam</p>", "Sam", "Samuel")).toBe("<p>Hi</p><p></p><p>-- </p><p>Samuel</p>");
    expect(swapSignatureHtml("<p>Hi</p><p></p><p>-- </p><p>Sam</p>", "Sam", "")).toBe("<p>Hi</p>");
    expect(swapSignatureHtml("<p>Hi</p>", "", "Sam")).toBe("<p>Hi</p><p></p><p>-- </p><p>Sam</p>");
    expect(swapSignatureHtml("<p></p><blockquote>q</blockquote>", "", "Sam", "<blockquote>q</blockquote>")).toBe(
      "<p></p><p></p><p>-- </p><p>Sam</p><blockquote>q</blockquote>",
    );
    expect(swapSignatureHtml("<p>Hi</p><p></p><p>-- </p><p>Sam (edited)</p>", "Sam (old)", "New")).toBe(
      "<p>Hi</p><p></p><p>-- </p><p>Sam (edited)</p>",
    );
  });
});

describe("plainText", () => {
  it("writes the editor's document as mail text: quotes marked, lists numbered or dashed, mentions by name", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi " }, { type: "mention", attrs: { id: "ada@x", label: "Ada" } }] },
        { type: "paragraph" },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
        { type: "paragraph", content: [{ type: "text", text: "On Monday, Maya wrote:" }] },
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
            { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "older" }] }] },
          ],
        },
      ],
    };
    expect(plainText(doc)).toBe("Hi @Ada\n\n- one\n1. first\na\nb\nOn Monday, Maya wrote:\n> Hi\n> > older");
  });
});
