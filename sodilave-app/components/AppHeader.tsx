import Link from "next/link";
import Image from "next/image";
import { logoutAction } from "@/app/actions/auth";
import { getShift } from "@/lib/shift";
import { LogOut, UserRound } from "lucide-react";

export function AppHeader({user}:{user:{name:string;role:string}}){
  const shift=getShift();
  return <header className="topbar"><Link href="/dashboard" className="brand"><Image src="/logo-sodilave.png" alt="Sodilave" width={390} height={112} className="brand-logo" priority/></Link><div className="user-area"><UserRound/><div><strong>{user.name}</strong><small>{shift.label}</small></div><form action={logoutAction}><button className="icon-btn" title="Sair"><LogOut/></button></form></div></header>;
}
