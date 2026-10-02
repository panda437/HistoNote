export function assertServiceSecret(secret: string) {
  const expected = process.env.CONVEX_SERVICE_SECRET;
  if (!expected || secret.length < 24 || secret !== expected) {
    throw new Error("Unauthorized");
  }
}
