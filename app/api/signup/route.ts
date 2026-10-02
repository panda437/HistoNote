import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { convexServer, serviceSecret } from "@/lib/convex-server";
import { apiError } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const passwordHash = await hash(input.password, 12);
    const id = await convexServer().mutation(api.users.create, {
      secret: serviceSecret(),
      name: input.name,
      email: input.email,
      passwordHash,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not create account");
  }
}
