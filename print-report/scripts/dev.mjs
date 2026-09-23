// Local run: the real worker over node:sqlite, static files from ./public.
//   npm run dev            → http://localhost:8788/print/
//   DB=/tmp/print.db npm run dev   (persist between runs)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import worker from "../src/worker.js";
import { makeD1 } from "../test/helpers/d1.js";

const root = new URL("../public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

async function asset(req) {
  let p = normalize(new URL(req.url).pathname).replace(/^(\.\.[/\\])+/, "");
  if (p === "/print") return new Response(null, { status: 307, headers: { location: "/print/" } });
  if (p.endsWith("/")) p += "index.html";
  else if (!extname(p)) p += ".html";           // auto-trailing-slash: /print/report → report.html
  try { return new Response(await readFile(join(root, p)), { headers: { "content-type": TYPES[extname(p)] || "application/octet-stream" } }); }
  catch { return new Response("not found", { status: 404 }); }
}

const env = { DB: makeD1(process.env.DB || ":memory:"), ASSETS: { fetch: asset } };
const port = +process.env.PORT || 8788;
createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`cims-print dev → http://localhost:${port}/print/`));
