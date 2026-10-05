import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const assets = [
  [
    "/footer-art/issue-pages.webp",
    "image/webp",
    "48cb385b690c316cd22f44254e3abcb94de63b1be85f515263615719513ec7ac",
  ],
  [
    "/footer-art/issue-pages-provenance.json",
    "application/json",
    "af3c34e0e56af2299fa967f84227a21b766d9b7d19f0d54b3af207f7e7c87d18",
  ],
  [
    "/fonts/fleet-footer-precise-v1/geist.woff2",
    "font/woff2",
    "19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1",
  ],
  [
    "/fonts/fleet-footer-precise-v1/geistmono.woff2",
    "font/woff2",
    "3f98383b122fe015a48536cd4a1cda855a201718923ffe74931a01597107b9b5",
  ],
  [
    "/fonts/fleet-footer-precise-v1/newsreader.woff2",
    "font/woff2",
    "6e4f2958c3a7c4a80acde4e5a679abe7e01bc1e30b92be3c7a8b696ef401d101",
  ],
];

const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const address = reservation.address();
if (!address || typeof address === "string") throw new Error("Could not reserve an ephemeral port");
const port = address.port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);

const child = spawn(
  process.execPath,
  [wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--log-level", "error"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
child.stdout.setEncoding("utf8").on("data", (chunk) => (logs += chunk));
child.stderr.setEncoding("utf8").on("data", (chunk) => (logs += chunk));
const base = `http://127.0.0.1:${port}`;

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`wrangler dev exited early (${child.exitCode})\n${logs}`);
    try {
      const response = await fetch(`${base}/footer-art/issue-pages.webp`);
      if (response.status === 200) {
        await response.arrayBuffer();
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error(`wrangler dev did not serve the footer bundle\n${logs}`);

  for (const [path, contentType, expectedHash] of assets) {
    const response = await fetch(`${base}${path}`);
    if (response.status !== 200) throw new Error(`${path}: expected 200, got ${response.status}`);
    if (!response.headers.get("content-type")?.includes(contentType)) {
      throw new Error(`${path}: unexpected content-type ${response.headers.get("content-type")}`);
    }
    const bytes = await response.arrayBuffer();
    const actualHash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    if (actualHash !== expectedHash) throw new Error(`${path}: SHA-256 mismatch (${actualHash})`);
    if (path.endsWith("issue-pages-provenance.json")) {
      const provenance = Buffer.from(bytes).toString("utf8");
      if (provenance.includes("/Users/")) {
        throw new Error("Public art provenance must not expose local filesystem paths");
      }
      const record = JSON.parse(provenance);
      if (
        record.derivative?.sha256 !==
        "48cb385b690c316cd22f44254e3abcb94de63b1be85f515263615719513ec7ac"
      ) {
        throw new Error("Public art provenance does not match the deployed derivative hash");
      }
    }

    const head = await fetch(`${base}${path}`, { method: "HEAD" });
    if (head.status !== 200 || (await head.arrayBuffer()).byteLength !== 0) {
      throw new Error(`${path}: HEAD must return 200 with no body`);
    }
  }

  for (const [path, method, expectedStatus] of [
    ["/footer-art/missing.webp", "GET", 404],
    ["/fonts/fleet-footer-precise-v1/unknown.woff2", "GET", 404],
    ["/footer-art/issue-pages.webp", "POST", 405],
    ["/fonts/fleet-footer-precise-v1/geist.woff2", "OPTIONS", 405],
  ]) {
    const response = await fetch(`${base}${path}`, { method });
    if (response.status !== expectedStatus)
      throw new Error(`${method} ${path}: expected ${expectedStatus}, got ${response.status}`);
  }

  console.log(
    `Cloudflare local assets served with exact hashes (${assets.length} assets; GET/HEAD only).`,
  );
} finally {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
}
