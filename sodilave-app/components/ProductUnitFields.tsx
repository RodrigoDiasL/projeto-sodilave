"use client";
import { useState } from "react";
export function ProductUnitFields({unit="BAG",count}:{unit?:string;count?:number|null}) {
  const [selected,setSelected]=useState(unit);
  return <><label>Unidade de produção / stock<select name="productionUnit" value={selected} onChange={e=>setSelected(e.target.value)}><option value="BAG">Saco</option><option value="PALLET">Palete</option><option value="UNIT">Unidade</option></select></label>
    <label>Artigos por unidade de produção{selected==="UNIT"?<input name="unitsPerPackage" value="1" readOnly/>:<input name="unitsPerPackage" type="number" min="1" max="100000" step="1" defaultValue={count??""} required/>}<small>{selected==="UNIT"?"Cada unidade produzida corresponde a um artigo em stock.":"Número de artigos em cada saco ou palete."}</small></label></>;
}
