import "server-only";

import { ConvexHttpClient } from "convex/browser";

let client: ConvexHttpClient | undefined;

export function convexServer() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  client ??= new ConvexHttpClient(url);
  return client;
}

export function serviceSecret() {
  const secret = process.env.CONVEX_SERVICE_SECRET;
  if (!secret) throw new Error("CONVEX_SERVICE_SECRET is not configured");
  return secret;
}
