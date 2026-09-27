import { requireAuditAccess } from "@/lib/auth";
import { redirect } from "next/navigation";
export default async function Page(){await requireAuditAccess();redirect("/admin/raw-materials");}
