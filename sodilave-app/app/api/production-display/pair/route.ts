import { NextRequest, NextResponse } from "next/server";
import { pairDisplay } from "@/lib/production-display";
import { AuthRateLimitError } from "@/lib/auth-rate-limit";
export async function POST(request: NextRequest) {
  const headers={"Cache-Control":"no-store"};
  // An eight-digit pairing code never needs a large request body.
  if (Number(request.headers.get("content-length")) > 256) return NextResponse.json({error:"Pedido inválido."},{status:413,headers});
  try {
    const reader=request.body?.getReader();
    let body="", size=0;
    const decoder=new TextDecoder();
    if(reader) { try { while(true) {
      const chunk=await reader.read();if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>256){await reader.cancel();return NextResponse.json({error:"Pedido inválido."},{status:413,headers});}
      body+=decoder.decode(chunk.value,{stream:true});
    } body+=decoder.decode(); } finally {reader.releaseLock();} }
    const data=JSON.parse(body);
    await pairDisplay(typeof data?.code === "string" ? data.code : "");
    return NextResponse.json({ok:true},{headers});
  } catch(error) {
    const rate=error instanceof AuthRateLimitError;
    return NextResponse.json({error:rate ? error.message : "Não foi possível emparelhar. Verifique o código e a ligação."},{status:rate?429:400,headers});
  }
}
