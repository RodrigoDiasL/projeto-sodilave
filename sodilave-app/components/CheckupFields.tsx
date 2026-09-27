"use client";
import { useState } from "react";
import { conditionTone, pressureTone } from "@/lib/checkup-values";
export function ConditionSelect({name, label, initial, kind, options}: {name:string;label:string;initial?:string|null;kind:"temperature"|"level";options:Record<string,string>}) {
  const [value,setValue]=useState(initial??"");
  return <label>{label}<select name={name} value={value} className={conditionTone(kind,value)} onChange={e=>setValue(e.target.value)}><option value="">Selecione</option>{Object.entries(options).map(([key,text])=><option value={key} key={key}>{text}</option>)}</select></label>;
}
export function PressureField({name,label,initial,min,max}: {name:string;label:string;initial?:unknown;min:number;max:number}) {
  const [value,setValue]=useState(initial==null?"":String(initial));
  const tone=pressureTone(value,min,max);
  return <label>{label}<input name={name} type="number" step="0.1" min="0" max="50" value={value} className={tone} onChange={e=>setValue(e.target.value)}/><small>{value ? (tone==="condition-green"?"Normal":"Fora do intervalo normal")+" · " : "Normal: "}{min}–{max} bar</small></label>;
}
