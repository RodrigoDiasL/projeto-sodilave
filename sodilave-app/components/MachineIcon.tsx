"use client";

import { useState, type CSSProperties } from "react";
import { Factory } from "lucide-react";
import jerrycanIcon from "@/public/machine-jerrycan.png";

type Props = { code: string; style?: CSSProperties };

export function MachineIcon({code,style}:Props) {
  // A static import checks the asset at build time and gives it a hashed URL.
  const src = ["5","6"].includes(String(code)) ? "/maq-tampas.png" : jerrycanIcon.src;
  const [failedSrc,setFailedSrc] = useState<string|null>(null);
  if(failedSrc===src) return <Factory aria-hidden="true" style={{width:58,height:48,...style}}/>;
  return <img src={src} alt="" width={96} height={96} style={style} onError={()=>setFailedSrc(src)}/>;
}
