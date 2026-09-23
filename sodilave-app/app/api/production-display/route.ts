import { NextResponse } from "next/server";
import { getDisplayDevice, getProductionDisplayData } from "@/lib/production-display";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    if (!await getDisplayDevice()) return NextResponse.json({error:"Emparelhe este ecrã."},{status:401,headers});
    return NextResponse.json(await getProductionDisplayData(),{headers});
  } catch { return NextResponse.json({error:"Ligação temporariamente indisponível."},{status:503,headers}); }
}
