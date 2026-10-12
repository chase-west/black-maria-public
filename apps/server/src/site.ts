import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PALETTE, absoluteAssetUrl, escapeHtml, renderIndexHtml, type SiteManifest } from "@blackmaria/style";

/** The art manifest, then the placeholder manifest, read fresh so art can be swapped without a restart. */
export function readManifests(assetsDir: string): SiteManifest[] {
  return ["manifest.json", "manifest.placeholders.json"].map((f) => {
    try {
      const j: unknown = JSON.parse(readFileSync(join(assetsDir, f), "utf8"));
      return j && typeof j === "object" && !Array.isArray(j) ? (j as SiteManifest) : {};
    } catch {
      return {};
    }
  });
}

/** The built `index.html` with its head filled: favicon, apple-touch-icon and the social card on `PUBLIC_URL`. */
export function indexHtml(webDist: string, assetsDir: string, publicUrl: string): string | null {
  let html: string;
  try {
    html = readFileSync(join(webDist, "index.html"), "utf8");
  } catch {
    return null;
  }
  return renderIndexHtml(html, { publicUrl, manifests: readManifests(assetsDir) });
}

/** What an email's HTML needs to know about the site. */
export interface EmailSite {
  publicUrl: string;
  manifests: readonly SiteManifest[];
}

const P = PALETTE;

/** One line of plain text as HTML: a bare URL becomes a link, `**x**` becomes bold. */
function lineHtml(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${P.cocoa};font-weight:700;text-decoration-color:${P.mustard}">$1</a>`);
}

/**
 * The HTML version of an email the stub writes to the outbox (SPEC 2, 2.1): `art_email_banner` on top, the text in
 * paragraphs, `email_footer` at the bottom. Inline styles and the palette only, for mail clients. Images are absolute.
 */
export function emailHtml(subject: string, text: string, site: EmailSite): string {
  const banner = absoluteAssetUrl(site.publicUrl, site.manifests, "art_email_banner");
  const footer = absoluteAssetUrl(site.publicUrl, site.manifests, "email_footer");
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split("\n");
      if (lines.every((l) => l.startsWith("> "))) {
        return `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:6px solid ${P.mustard};font-family:'Space Mono',monospace;font-size:14px">${lines.map((l) => `<p style="margin:0 0 8px">${lineHtml(l.slice(2))}</p>`).join("")}</blockquote>`;
      }
      return `<p style="margin:0 0 16px">${lines.map(lineHtml).join("<br>")}</p>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,900,100,1&amp;family=Nunito:wght@400;700;900&amp;family=Space+Mono:wght@400;700&amp;display=swap"></head>
<body style="margin:0;padding:0;background:${P.cream};color:${P.cocoa}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${P.cream}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${P.cream};border:3px solid ${P.cocoa};border-radius:12px">
<tr><td><img src="${escapeHtml(banner)}" width="600" alt="" style="display:block;width:100%;height:auto;border-radius:9px 9px 0 0"></td></tr>
<tr><td style="padding:20px 28px 4px;font-family:Nunito,sans-serif;font-size:17px;line-height:1.5">
<h1 style="margin:0 0 16px;font-family:Fraunces,Georgia,serif;font-weight:900;font-size:26px;line-height:1.1">${escapeHtml(subject)}</h1>
${paras}
</td></tr>
<tr><td><img src="${escapeHtml(footer)}" width="600" alt="" style="display:block;width:100%;height:auto;border-radius:0 0 9px 9px"></td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}
