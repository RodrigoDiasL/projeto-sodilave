import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "ok",
        database: "ok",
        version: process.env.APP_VERSION || "0.9.8",
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startedAt,
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unavailable",
        version: process.env.APP_VERSION || "0.9.8",
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
