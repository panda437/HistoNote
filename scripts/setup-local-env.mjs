import { execFileSync } from "node:child_process";

function setConvexEnv(name, value) {
  execFileSync("npx", ["convex", "env", "set", name, value], {
    stdio: "ignore",
    env: process.env,
  });
}

setConvexEnv("OPENAI_REPORT_MODEL", "gpt-5-mini");
setConvexEnv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe");

if (process.env.OPENAI_API_KEY) {
  setConvexEnv("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  console.log("Convex AI environment variables are configured.");
} else {
  console.log("Convex model settings are configured. OPENAI_API_KEY was not available in this shell.");
}
