import { GET as getLegacyMachineImage } from "../maq-garrafoes.png/route";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  return getLegacyMachineImage();
}
