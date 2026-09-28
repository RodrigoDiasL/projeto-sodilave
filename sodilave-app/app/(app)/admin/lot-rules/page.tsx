import { redirect } from "next/navigation";
import { requireReadAccess } from "@/lib/auth";
export default async function Page(){await requireReadAccess();redirect("/commercial-lots");}
