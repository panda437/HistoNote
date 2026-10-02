import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env.local");
const source = existsSync(target) ? readFileSync(target, "utf8") : "";
const lines = source.split(/\r?\n/).filter(Boolean);

function valueOf(name) {
  const line = lines.find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1) : undefined;
}

function setValue(name, value) {
  const index = lines.findIndex((entry) => entry.startsWith(`${name}=`));
  const line = `${name}=${value}`;
  if (index >= 0) lines[index] = line;
  else lines.push(line);
}

const authSecret = valueOf("AUTH_SECRET") || randomBytes(32).toString("base64url");
const serviceSecret = valueOf("CONVEX_SERVICE_SECRET") || randomBytes(32).toString("hex");

setValue("AUTH_SECRET", authSecret);
setValue("AUTH_TRUST_HOST", "true");
setValue("CONVEX_SERVICE_SECRET", serviceSecret);
writeFileSync(target, `${lines.join("\n")}\n`, { mode: 0o600 });

function setConvexEnv(name, value) {
  execFileSync("npx", ["convex", "env", "set", name, value], {
    stdio: "ignore",
    env: process.env,
  });
}

setConvexEnv("CONVEX_SERVICE_SECRET", serviceSecret);
setConvexEnv("OPENAI_REPORT_MODEL", "gpt-5-mini");
setConvexEnv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe");

if (process.env.OPENAI_API_KEY) {
  setConvexEnv("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  console.log("Local Auth.js and Convex secrets are configured; the existing OpenAI key is available to Convex.");
} else {
  console.log("Local Auth.js and Convex secrets are configured. OPENAI_API_KEY was not available in this shell.");
}
